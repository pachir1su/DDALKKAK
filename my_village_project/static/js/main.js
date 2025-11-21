/**
 * ==========================================
 *  VAST VILLAGE ENGINE (Procedural Generation)
 * ==========================================
 */

class VillageWorld {
  constructor() {
    this.config = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.simplex = new SimplexNoise();

    this.objects = {
      houses: null,
      trees: null,
      clouds: null,
      water: null,
      ground: null,
    };

    this.lights = {
      sun: null,
      ambient: null,
      hemi: null,
    };

    this.isNight = false;
    this.time = 0;

    // 텍스처 생성 (이미지 파일 없이 코드로 텍스처를 만듭니다)
    this.textures = {
      roof: this.createTexture("roof"),
      wall: this.createTexture("wall"),
      grass: this.createTexture("grass"),
    };

    this.init();
  }

  async init() {
    // 1. 서버에서 설정 가져오기
    try {
      const res = await fetch("/api/world-config");
      this.config = await res.json();
    } catch (e) {
      console.warn("서버 연결 실패, 기본값 사용");
      this.config = {
        seed: 123,
        worldSize: 600,
        houseCount: 400,
        treeCount: 1500,
      };
    }

    // 2. Three.js 기본 셋업
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x88ccff);
    this.scene.fog = new THREE.Fog(0x88ccff, 50, 400); // 깊이감 추가

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      1000
    );
    this.camera.position.set(100, 100, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(
      this.camera,
      this.renderer.domElement
    );
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // 땅 밑으로 못 가게
    this.controls.enableDamping = true;

    // 3. 조명 설정
    this.setupLights();

    // 4. 월드 생성
    this.generateWorld();

    // 5. 이벤트 리스너
    window.addEventListener("resize", () => this.onResize());

    // 6. 렌더링 시작
    this.update();

    document.getElementById("status").innerText = "세계 탐험 준비 완료";
  }

  setupLights() {
    this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(this.lights.ambient);

    this.lights.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
    this.scene.add(this.lights.hemi);

    this.lights.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.lights.sun.position.set(100, 200, 100);
    this.lights.sun.castShadow = true;

    // 그림자 품질 설정 (넓은 맵을 커버하기 위해)
    this.lights.sun.shadow.mapSize.width = 2048;
    this.lights.sun.shadow.mapSize.height = 2048;
    const d = 300;
    this.lights.sun.shadow.camera.left = -d;
    this.lights.sun.shadow.camera.right = d;
    this.lights.sun.shadow.camera.top = d;
    this.lights.sun.shadow.camera.bottom = -d;

    this.scene.add(this.lights.sun);
  }

  // --- 텍스처 생성 유틸리티 ---
  createTexture(type) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    if (type === "roof") {
      ctx.fillStyle = "#8a4b32";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "#6e3b28";
      for (let i = 0; i < 10; i++) ctx.fillRect(Math.random() * 64, 0, 4, 64); // 기와 느낌
    } else if (type === "wall") {
      ctx.fillStyle = "#e0d6c5";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "#d1c4b0";
      for (let i = 0; i < 20; i++)
        ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); // 노이즈
    } else {
      // grass
      ctx.fillStyle = "#4caf50";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "#388e3c";
      for (let i = 0; i < 40; i++)
        ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // --- 지형 및 객체 생성 (핵심 로직) ---
  generateWorld() {
    // 기존 객체 삭제
    if (this.objects.ground) this.scene.remove(this.objects.ground);
    if (this.objects.water) this.scene.remove(this.objects.water);
    if (this.objects.houses) this.scene.remove(this.objects.houses);
    if (this.objects.trees) this.scene.remove(this.objects.trees);

    const worldSize = this.config.worldSize;
    const halfSize = worldSize / 2;

    // 1. 지형 (Terrain) 생성
    // Vertex 색상 방식을 사용하여 텍스처 로딩 없이 자연스러운 지형 연출
    const geometry = new THREE.PlaneGeometry(worldSize, worldSize, 150, 150);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    const colors = [];
    const colorGrass = new THREE.Color(0x55aa55);
    const colorSand = new THREE.Color(0xeebb88);
    const colorRock = new THREE.Color(0x666666);
    const colorSnow = new THREE.Color(0xffffff);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // 노이즈로 높이 계산 (여러 레이어 합성)
      let y = this.getElevation(x, z);
      pos.setY(i, y);

      // 높이에 따른 색상 (Splatting)
      let color = new THREE.Color();
      if (y < 3) color = colorSand; // 해변
      else if (y < 30) color = colorGrass; // 평지
      else if (y < 60) color = colorRock; // 산
      else color = colorSnow; // 설산

      // 약간의 랜덤성 추가
      color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      flatShading: true,
    });
    this.objects.ground = new THREE.Mesh(geometry, groundMat);
    this.objects.ground.receiveShadow = true;
    this.scene.add(this.objects.ground);

    // 2. 물 (Water) 생성
    const waterGeo = new THREE.PlaneGeometry(worldSize, worldSize);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x22aaff,
      transparent: true,
      opacity: 0.6,
      roughness: 0.1,
      metalness: 0.5,
    });
    this.objects.water = new THREE.Mesh(waterGeo, waterMat);
    this.objects.water.position.y = 2.5; // 해수면 높이
    this.scene.add(this.objects.water);

    // 3. 인스턴싱을 이용한 대량의 나무와 집 생성 (최적화 필수)
    this.generateVegetation(pos);
    this.generateHouses(pos);
    this.generateClouds();
  }

  getElevation(x, z) {
    // 노이즈 함수 조합
    const zoom = 0.005;
    const base = this.simplex.noise2D(x * zoom, z * zoom) * 30;
    const detail = this.simplex.noise2D(x * zoom * 4, z * zoom * 4) * 5;
    // 중앙 근처를 평평하게 만들기 (마을 부지)
    const dist = Math.sqrt(x * x + z * z);
    const flatten = Math.max(0, 1 - dist / 150);

    return Math.max(-10, base + detail) * (1 - flatten * 0.5);
  }

  generateVegetation(terrainPos) {
    const count = this.config.treeCount;

    // 단순한 나무 모델 생성 (Cylinder + Cone)
    // 인스턴싱을 위해 Geometry 병합
    const trunkGeo = new THREE.CylinderGeometry(0.5, 1, 3, 5);
    trunkGeo.translate(0, 1.5, 0);
    const leavesGeo = new THREE.ConeGeometry(2.5, 6, 5);
    leavesGeo.translate(0, 5.5, 0);

    // BufferGeometryUtils가 없으므로 직접 하나의 Mesh로 합치지 않고
    // 두 개의 InstancedMesh를 사용하거나 그룹핑.. 여기선 간단히 잎사귀만 표현하거나
    // Cone 하나로 'Low Poly 나무'를 표현하겠습니다. (성능 고려)

    const treeGeo = new THREE.ConeGeometry(2, 8, 6);
    treeGeo.translate(0, 4, 0); // 바닥이 0점에 오도록
    const treeMat = new THREE.MeshStandardMaterial({
      color: 0x2d6e32,
      flatShading: true,
    });

    this.objects.trees = new THREE.InstancedMesh(treeGeo, treeMat, count);
    this.objects.trees.castShadow = true;
    this.objects.trees.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let instanceIndex = 0;

    for (let i = 0; i < count * 3; i++) {
      // 시도 횟수 늘림
      if (instanceIndex >= count) break;

      const x = (Math.random() - 0.5) * this.config.worldSize;
      const z = (Math.random() - 0.5) * this.config.worldSize;
      const y = this.getElevation(x, z);

      // 조건: 물 위나 너무 높은 산에는 나무 X
      if (y > 3.5 && y < 40) {
        dummy.position.set(x, y, z);

        // 크기 랜덤
        const scale = 0.5 + Math.random() * 1.0;
        dummy.scale.set(scale, scale, scale);
        dummy.rotation.y = Math.random() * Math.PI;

        dummy.updateMatrix();
        this.objects.trees.setMatrixAt(instanceIndex++, dummy.matrix);
      }
    }
    this.scene.add(this.objects.trees);
  }

  generateHouses(terrainPos) {
    const count = this.config.houseCount;

    // 집: Box(몸통) + Cone(지붕) 합체 형태 (InstancedMesh는 단일 재질이어야 해서 색상은 하나로 통일하거나 쉐이더 써야함)
    // 여기서는 간단하게 Box와 Cone을 각각 InstancedMesh로 만듭니다.

    const bodyGeo = new THREE.BoxGeometry(4, 4, 4);
    bodyGeo.translate(0, 2, 0);
    const bodyMat = new THREE.MeshStandardMaterial({ map: this.textures.wall }); // 벽 텍스처

    const roofGeo = new THREE.ConeGeometry(3.5, 3, 4);
    roofGeo.translate(0, 5.5, 0);
    roofGeo.rotateY(Math.PI / 4);
    const roofMat = new THREE.MeshStandardMaterial({ map: this.textures.roof }); // 지붕 텍스처

    const housesBody = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
    const housesRoof = new THREE.InstancedMesh(roofGeo, roofMat, count);

    housesBody.castShadow = true;
    housesBody.receiveShadow = true;
    housesRoof.castShadow = true;
    housesRoof.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let instanceIndex = 0;

    // 마을 중심 생성 (랜덤한 몇 개의 클러스터)
    const clusters = [];
    for (let k = 0; k < 5; k++) {
      clusters.push({
        x: (Math.random() - 0.5) * this.config.worldSize * 0.6,
        z: (Math.random() - 0.5) * this.config.worldSize * 0.6,
      });
    }

    for (let i = 0; i < count * 5; i++) {
      if (instanceIndex >= count) break;

      // 클러스터 기반 위치 선정 (마을 형성)
      const cluster = clusters[Math.floor(Math.random() * clusters.length)];
      const offsetX = (Math.random() - 0.5) * 100;
      const offsetZ = (Math.random() - 0.5) * 100;

      const x = cluster.x + offsetX;
      const z = cluster.z + offsetZ;
      const y = this.getElevation(x, z);

      // 조건: 평지이고 물 위가 아닐 것
      // 경사도 체크(간단히 주변 높이 비교)는 생략하고 높이 범위로만 제한
      if (y > 4 && y < 20) {
        dummy.position.set(x, y, z);
        dummy.rotation.y = Math.random() * Math.PI * 2;
        const s = 0.8 + Math.random() * 0.5;
        dummy.scale.set(s, s, s);

        dummy.updateMatrix();
        housesBody.setMatrixAt(instanceIndex, dummy.matrix);
        housesRoof.setMatrixAt(instanceIndex, dummy.matrix);
        instanceIndex++;
      }
    }

    this.objects.houses = new THREE.Group();
    this.objects.houses.add(housesBody);
    this.objects.houses.add(housesRoof);
    this.scene.add(this.objects.houses);
  }

  generateClouds() {
    const count = 30;
    this.objects.clouds = new THREE.Group();

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    });

    for (let i = 0; i < count; i++) {
      const cloud = new THREE.Group();
      // 뭉게구름 만들기 (박스 뭉치기)
      for (let j = 0; j < 5 + Math.random() * 5; j++) {
        const bit = new THREE.Mesh(geo, mat);
        bit.position.set(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 5
        );
        bit.scale.set(
          4 + Math.random() * 4,
          2 + Math.random() * 2,
          4 + Math.random() * 4
        );
        cloud.add(bit);
      }
      cloud.position.set(
        (Math.random() - 0.5) * 400,
        60 + Math.random() * 30,
        (Math.random() - 0.5) * 400
      );
      this.objects.clouds.add(cloud);
    }
    this.scene.add(this.objects.clouds);
  }

  // --- 기능 컨트롤 ---
  toggleTime() {
    this.isNight = !this.isNight;
    const timeDisplay = document.getElementById("time-display");

    if (this.isNight) {
      // 밤 모드
      this.scene.background = new THREE.Color(0x050510);
      this.scene.fog.color.setHex(0x050510);
      this.scene.fog.density = 0.005;

      this.lights.sun.intensity = 0.1;
      this.lights.hemi.groundColor.setHex(0x000000);
      this.lights.hemi.skyColor.setHex(0x111122);

      timeDisplay.innerText = "Night";
    } else {
      // 낮 모드
      this.scene.background = new THREE.Color(0x88ccff);
      this.scene.fog.color.setHex(0x88ccff);
      this.scene.fog.density = 0.002;

      this.lights.sun.intensity = 1.2;
      this.lights.hemi.groundColor.setHex(0x444444);
      this.lights.hemi.skyColor.setHex(0xffffff);

      timeDisplay.innerText = "Day";
    }
  }

  regenerate() {
    this.config.seed = Math.random() * 10000;
    this.simplex = new SimplexNoise(this.config.seed.toString());
    this.generateWorld();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  update() {
    requestAnimationFrame(() => this.update());

    this.time += 0.005;

    // 구름 이동
    if (this.objects.clouds) {
      this.objects.clouds.children.forEach((cloud) => {
        cloud.position.x += 0.05;
        if (cloud.position.x > 300) cloud.position.x = -300;
      });
    }

    // 물결 움직임 (텍스처 오프셋 대신 간단한 상하 이동으로 대체)
    // 쉐이더 없이 구현하기 위해 생략하거나 간단히 구현

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// 앱 실행
const worldApp = new VillageWorld();
