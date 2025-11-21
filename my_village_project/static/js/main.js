/**
 * ============================================================
 *  HIGH-FIDELITY VILLAGE ENGINE
 *  Features: Custom Shaders, Unreal Bloom, Dynamic Sky, Particles
 * ============================================================
 */

// --- GLSL 쉐이더 코드 (물 효과) ---
const WATER_VERTEX_SHADER = `
    uniform float uTime;
    varying float vElevation;
    varying vec2 vUv;

    // 간단한 노이즈 함수
    float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
    
    void main() {
        vUv = uv;
        vec4 modelPosition = modelMatrix * vec4(position, 1.0);

        // 물결 파동 계산 (여러 사인파 합성)
        float elevation = sin(modelPosition.x * 0.1 + uTime) * 0.4;
        elevation += sin(modelPosition.z * 0.08 + uTime * 0.8) * 0.4;
        elevation -= abs(sin(modelPosition.x * 0.3 - uTime * 0.5) * 0.2); // 뾰족한 부분

        modelPosition.y += elevation;
        vElevation = elevation;

        vec4 viewPosition = viewMatrix * modelPosition;
        vec4 projectedPosition = projectionMatrix * viewPosition;
        gl_Position = projectedPosition;
    }
`;

const WATER_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform vec3 uDepthColor;
    uniform vec3 uSurfaceColor;
    varying float vElevation;
    varying vec2 vUv;

    void main() {
        // 높이에 따른 색상 믹스 (깊은 곳 vs 파도 끝)
        float mixStrength = (vElevation + 0.5) * 1.2;
        vec3 color = mix(uDepthColor, uSurfaceColor, mixStrength);
        
        // 반짝이는 하이라이트 (Foam)
        if(vElevation > 0.5) {
            color = mix(color, vec3(1.0), 0.5); 
        }

        gl_FragColor = vec4(color, 0.85); // 약간 투명하게
    }
`;

class UltraWorld {
  constructor() {
    this.config = {
      worldSize: 500,
      houseCount: 300,
      treeCount: 1200,
    };

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.composer = null; // 포스트 프로세싱
    this.controls = null;
    this.simplex = new SimplexNoise();
    this.clock = new THREE.Clock();

    // 애니메이션 관련
    this.uniforms = {
      uTime: { value: 0 },
    };
    this.dayTime = 0;
    this.autoRotate = false;

    this.objects = {};
    this.particles = [];

    this.init();
  }

  init() {
    // 1. 씬 & 카메라
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x222233);
    this.scene.fog = new THREE.FogExp2(0x222233, 0.0025);

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      1,
      2000
    );
    this.camera.position.set(120, 80, 120);

    // 2. 렌더러 (고화질 설정)
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 레티나 디스플레이 지원
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // 부드러운 그림자
    this.renderer.outputEncoding = THREE.sRGBEncoding; // 색상 보정
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // 영화 같은 톤 매핑
    this.renderer.toneMappingExposure = 1.0;
    document.body.appendChild(this.renderer.domElement);

    // 3. 컨트롤
    this.controls = new THREE.OrbitControls(
      this.camera,
      this.renderer.domElement
    );
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

    // 4. 조명 시스템 (태양)
    this.setupLights();

    // 5. 포스트 프로세싱 (블룸 효과) 설정 - 여기가 핵심!
    this.setupPostProcessing();

    // 6. 월드 생성
    this.generateWorld();

    // 7. 이벤트 & 루프
    window.addEventListener("resize", () => this.onResize());
    this.update();

    document.getElementById("status").innerText = "✨ 렌더링 준비 완료";
  }

  setupLights() {
    this.ambientLight = new THREE.AmbientLight(0xb9d5ff, 0.3);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffaa33, 1.5);
    this.sunLight.position.set(100, 50, 100);
    this.sunLight.castShadow = true;

    // 그림자 해상도 대폭 증가
    this.sunLight.shadow.mapSize.width = 4096;
    this.sunLight.shadow.mapSize.height = 4096;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 600;
    const d = 300;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005; // 그림자 줄무늬 제거

    this.scene.add(this.sunLight);
  }

  setupPostProcessing() {
    // 렌더 패스
    const renderScene = new THREE.RenderPass(this.scene, this.camera);

    // 블룸 패스 (빛 번짐 효과)
    const bloomPass = new THREE.UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5,
      0.4,
      0.85
    );
    bloomPass.threshold = 0.2; // 이 밝기 이상만 번짐
    bloomPass.strength = 0.4; // 번짐 강도 (너무 세면 눈부심)
    bloomPass.radius = 0.5;

    this.composer = new THREE.EffectComposer(this.renderer);
    this.composer.addPass(renderScene);
    this.composer.addPass(bloomPass);
  }

  // --- 월드 생성 로직 ---
  generateWorld() {
    // 초기화
    if (this.objects.group) this.scene.remove(this.objects.group);
    this.objects.group = new THREE.Group();
    this.scene.add(this.objects.group);
    this.particles = [];

    // 1. 고급 지형 (Terrain)
    this.createTerrain();

    // 2. 쉐이더 바다 (Water)
    this.createWater();

    // 3. 식생 및 건축물
    this.populateWorld();

    // 4. 파티클 (연기)
    this.createSmokeParticles();
  }

  createTerrain() {
    const geo = new THREE.PlaneGeometry(
      this.config.worldSize,
      this.config.worldSize,
      200,
      200
    );
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = [];
    const cSand = new THREE.Color(0xe8dcb5);
    const cGrass = new THREE.Color(0x599c4f);
    const cRock = new THREE.Color(0x555555);
    const cSnow = new THREE.Color(0xffffff);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // 다층 노이즈 (FBM)
      let y = this.simplex.noise2D(x * 0.004, z * 0.004) * 40;
      y += this.simplex.noise2D(x * 0.01, z * 0.01) * 10;
      y += this.simplex.noise2D(x * 0.03, z * 0.03) * 2;

      // 섬 형태로 만들기 (가장자리 낮춤)
      const dist = Math.sqrt(x * x + z * z);
      const falloff = Math.max(
        0,
        1 - Math.pow(dist / (this.config.worldSize * 0.45), 3)
      );
      y *= falloff;
      y -= 5; // 해수면 조정

      pos.setY(i, y);

      // 색상 블렌딩 (Vertex Color)
      let color = new THREE.Color();
      if (y < 2) color = cSand;
      else if (y < 35) color.copy(cGrass).lerp(cRock, (y - 2) / 33);
      else if (y < 50) color = cRock;
      else color = cSnow;

      // 색상 노이즈 추가 (단조로움 방지)
      color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.03);
      colors.push(color.r, color.g, color.b);
    }

    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.objects.group.add(mesh);

    this.terrainGeo = geo; // 나중에 높이 계산용 저장
  }

  createWater() {
    const geo = new THREE.PlaneGeometry(
      this.config.worldSize,
      this.config.worldSize,
      64,
      64
    );
    geo.rotateX(-Math.PI / 2);

    // 커스텀 쉐이더 매터리얼
    const mat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: {
        uTime: this.uniforms.uTime,
        uDepthColor: { value: new THREE.Color(0x186691) },
        uSurfaceColor: { value: new THREE.Color(0x9bd8ff) },
      },
      transparent: true,
      side: THREE.DoubleSide,
    });

    const water = new THREE.Mesh(geo, mat);
    water.position.y = 1.5;
    this.objects.group.add(water);
  }

  populateWorld() {
    // --- 나무 (더 예쁜 모양: Dodecahedron Leaves) ---
    const treeCount = this.config.treeCount;

    // 나무 모델링 (InstancedMesh를 위한 Group 대체) -> BufferGeometry 병합 필요하지만
    // 여기서는 간단히 InstancedMesh 2개(기둥, 잎) 사용
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 2, 5);
    trunkGeo.translate(0, 1, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x5c4033,
      flatShading: true,
    });

    const leafGeo = new THREE.DodecahedronGeometry(2.5);
    leafGeo.translate(0, 3.5, 0);
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x3a7a3a,
      flatShading: true,
    });

    const meshTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const meshLeaf = new THREE.InstancedMesh(leafGeo, leafMat, treeCount);
    meshTrunk.castShadow = true;
    meshTrunk.receiveShadow = true;
    meshLeaf.castShadow = true;
    meshLeaf.receiveShadow = true;

    // --- 집 (굴뚝 포함) ---
    const houseCount = this.config.houseCount;
    const houseBodyGeo = new THREE.BoxGeometry(5, 4, 5);
    houseBodyGeo.translate(0, 2, 0);
    const houseRoofGeo = new THREE.ConeGeometry(4, 3, 4);
    houseRoofGeo.translate(0, 5.5, 0);
    houseRoofGeo.rotateY(Math.PI / 4);

    const matBody = new THREE.MeshStandardMaterial({ color: 0xf2e6d8 });
    const matRoof = new THREE.MeshStandardMaterial({ color: 0xcc5533 });

    const meshHouse = new THREE.InstancedMesh(
      houseBodyGeo,
      matBody,
      houseCount
    );
    const meshRoof = new THREE.InstancedMesh(houseRoofGeo, matRoof, houseCount);
    meshHouse.castShadow = true;
    meshHouse.receiveShadow = true;
    meshRoof.castShadow = true;
    meshRoof.receiveShadow = true;

    // 배치 로직
    const dummy = new THREE.Object3D();
    const positions = this.terrainGeo.attributes.position;
    let tIdx = 0,
      hIdx = 0;

    for (let i = 0; i < 5000; i++) {
      // 시도 횟수 넉넉히
      const x = (Math.random() - 0.5) * this.config.worldSize * 0.8;
      const z = (Math.random() - 0.5) * this.config.worldSize * 0.8;

      // 높이 찾기 (근사치 말고 정확히 계산하거나 Raycaster 써야하지만, 여기선 노이즈 재계산)
      let y = this.getElevation(x, z);

      // 나무 배치 (해변~산)
      if (tIdx < treeCount && y > 3 && y < 45) {
        // 물가는 야자수 느낌으로 스케일 조정 가능하나 일단 통일
        dummy.position.set(x, y, z);
        const s = 0.5 + Math.random();
        dummy.scale.set(s, s * 1.2, s);
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.updateMatrix();

        meshTrunk.setMatrixAt(tIdx, dummy.matrix);
        meshLeaf.setMatrixAt(tIdx, dummy.matrix);

        // 잎 색상 변형 (가을 느낌 살짝 섞기)
        const colorVar = new THREE.Color(0x3a7a3a);
        if (Math.random() < 0.1) colorVar.setHex(0xcc8833); // 단풍
        meshLeaf.setColorAt(tIdx, colorVar);

        tIdx++;
      }

      // 집 배치 (평평한 곳 위주)
      if (hIdx < houseCount && y > 5 && y < 25) {
        // 군집화 (클러스터링)
        if (Math.random() > 0.4) continue; // 40% 확률로만 생성 (듬성듬성 방지용 로직 필요하나 생략)

        dummy.position.set(x, y, z);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.y = Math.random() * Math.PI * 2;
        dummy.updateMatrix();

        meshHouse.setMatrixAt(hIdx, dummy.matrix);
        meshRoof.setMatrixAt(hIdx, dummy.matrix);

        // 굴뚝 연기 위치 저장
        this.particles.push({
          pos: new THREE.Vector3(x, y + 6, z),
          timer: Math.random() * 100,
        });

        hIdx++;
      }
    }

    this.objects.group.add(meshTrunk);
    this.objects.group.add(meshLeaf);
    this.objects.group.add(meshHouse);
    this.objects.group.add(meshRoof);
  }

  getElevation(x, z) {
    // 생성 시 사용한 노이즈 함수와 동일해야 함
    let y = this.simplex.noise2D(x * 0.004, z * 0.004) * 40;
    y += this.simplex.noise2D(x * 0.01, z * 0.01) * 10;
    y += this.simplex.noise2D(x * 0.03, z * 0.03) * 2;
    const dist = Math.sqrt(x * x + z * z);
    const falloff = Math.max(
      0,
      1 - Math.pow(dist / (this.config.worldSize * 0.45), 3)
    );
    y *= falloff;
    return y - 5;
  }

  // 굴뚝 연기 (단순 Mesh 재활용)
  createSmokeParticles() {
    const geo = new THREE.DodecahedronGeometry(0.5);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xdddddd,
      transparent: true,
      opacity: 0.6,
    });
    this.smokeMesh = new THREE.InstancedMesh(
      geo,
      mat,
      this.particles.length * 5
    ); // 집마다 5개 파티클
    this.objects.group.add(this.smokeMesh);
  }

  updateSmoke() {
    if (!this.smokeMesh) return;
    const dummy = new THREE.Object3D();
    let idx = 0;

    this.particles.forEach((p) => {
      // 각 집마다 연기 뭉게뭉게
      const time = this.uniforms.uTime.value * 2;
      for (let i = 0; i < 5; i++) {
        const offset = (p.timer + i * 20 + time) % 100; // 0~100 사이클
        const normLife = offset / 100; // 0 -> 1 (수명)

        if (normLife < 1) {
          // 위로 올라갈수록 퍼짐
          const py = p.pos.y + normLife * 8;
          const px = p.pos.x + Math.sin(time * 0.5 + i) * normLife * 2;
          const pz = p.pos.z + Math.cos(time * 0.3 + i) * normLife * 2;

          dummy.position.set(px, py, pz);
          const s = 1 + normLife * 3;
          dummy.scale.set(s, s, s);
          dummy.rotation.x = time + i;
          dummy.updateMatrix();
          this.smokeMesh.setMatrixAt(idx++, dummy.matrix);
        }
      }
    });
    this.smokeMesh.instanceMatrix.needsUpdate = true;
  }

  updateDayNightCycle() {
    // 0 ~ 2PI 사이 회전
    this.dayTime += 0.005;

    const sunX = Math.cos(this.dayTime) * 150;
    const sunY = Math.sin(this.dayTime) * 150;
    this.sunLight.position.set(sunX, sunY, 50);

    // 하늘색과 조명 강도 조절
    const sunHeight = Math.sin(this.dayTime);
    const isNight = sunHeight < 0;

    // UI 시간 표시
    const hours = Math.floor(((this.dayTime / (Math.PI * 2)) * 24 + 6) % 24);
    const mins = Math.floor((this.dayTime % 0.1) * 600);
    document.getElementById("time-val").innerText = `${hours}:${
      mins < 10 ? "0" + mins : mins
    }`;

    if (isNight) {
      this.sunLight.intensity = 0;
      this.ambientLight.intensity = 0.1;
      this.scene.background.setHex(0x050510);
      this.scene.fog.color.setHex(0x050510);
      // 블룸 효과가 밤에 집 창문(구현한다면)이나 반사를 빛나게 함
    } else {
      // 낮 (노을 구현)
      this.sunLight.intensity = 1.5;
      this.ambientLight.intensity = 0.5;

      if (sunHeight < 0.3) {
        // 노을
        this.scene.background.setHex(0xffaa55);
        this.scene.fog.color.setHex(0xffaa55);
        this.sunLight.color.setHex(0xff8800);
      } else {
        // 한낮
        this.scene.background.setHex(0x88ccff);
        this.scene.fog.color.setHex(0x88ccff);
        this.sunLight.color.setHex(0xffaa33);
      }
    }
  }

  toggleRotation() {
    this.autoRotate = !this.autoRotate;
  }

  regenerate() {
    this.simplex = new SimplexNoise(Math.random().toString());
    this.generateWorld();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  update() {
    requestAnimationFrame(() => this.update());

    const delta = this.clock.getDelta();
    this.uniforms.uTime.value += delta;

    this.updateDayNightCycle();
    this.updateSmoke();

    if (this.autoRotate) {
      this.scene.rotation.y += 0.001;
    }

    this.controls.update();

    // 렌더러 대신 컴포저 사용 (포스트 프로세싱 적용)
    this.composer.render();
  }
}

const worldApp = new UltraWorld();
