class NeonRaceGame {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;

    // 게임 상태 변수
    this.isPlaying = false;
    this.speed = 0;
    this.score = 0;
    this.targetX = 0; // 마우스 목표 지점

    // 오브젝트 관리
    this.player = null;
    this.floor = null;
    this.obstacles = [];
    this.particles = [];

    // 설정값
    this.colors = {
      sky: 0x020205,
      grid: 0xff00ff,
      player: 0x00ffff,
      obstacle: 0xff3300,
    };

    this.init();
  }

  init() {
    // 1. 씬
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.colors.sky);
    this.scene.fog = new THREE.FogExp2(this.colors.sky, 0.015); // 안개 효과

    // 2. 카메라
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 3, 6);

    // 3. 렌더러
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(this.renderer.domElement);

    // 4. 조명
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(0, 10, 0);
    this.scene.add(dirLight);

    // 5. 오브젝트 생성
    this.createPlayer();
    this.createEnvironment();

    // 6. 이벤트
    window.addEventListener("resize", () => this.onResize());
    document.addEventListener("mousemove", (e) => this.onMouseMove(e));
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        if (this.isPlaying) return;
        this.start();
      }
    });

    this.animate();
  }

  createPlayer() {
    // 플레이어: 날렵한 삼각형 비행체
    const geometry = new THREE.ConeGeometry(0.5, 2, 4);
    geometry.rotateX(Math.PI / 2); // 눕히기
    geometry.rotateY(Math.PI / 4); // 모서리가 위로 오게

    const material = new THREE.MeshPhongMaterial({
      color: 0x111111,
      emissive: this.colors.player,
      emissiveIntensity: 0.8,
      flatShading: true,
    });

    this.player = new THREE.Mesh(geometry, material);
    this.player.position.y = 0.5;
    this.scene.add(this.player);

    // 엔진 불빛 (파티클용 더미)
    this.engine = new THREE.Object3D();
    this.engine.position.z = 1;
    this.player.add(this.engine);
  }

  createEnvironment() {
    // 무한 그리드 바닥 (Tron 스타일)
    const gridHelper = new THREE.GridHelper(
      200,
      50,
      this.colors.grid,
      0x222222
    );
    gridHelper.position.y = -0.5;
    this.floor = gridHelper;
    this.scene.add(this.floor);

    // 바닥 아래 반사판 (빛나는 느낌)
    const planeGeo = new THREE.PlaneGeometry(200, 200);
    planeGeo.rotateX(-Math.PI / 2);
    const planeMat = new THREE.MeshBasicMaterial({ color: 0x110022 });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.position.y = -0.6;
    this.scene.add(plane);
  }

  start() {
    // 게임 상태 초기화
    this.isPlaying = true;
    this.score = 0;
    this.speed = 40; // 시작 속도
    this.targetX = 0;
    this.player.position.x = 0;
    this.player.rotation.z = 0;
    this.player.visible = true;

    // UI 숨기기
    document.getElementById("start-screen").style.display = "none";
    document.getElementById("game-over-screen").style.display = "none";

    // 기존 장애물 제거
    this.obstacles.forEach((obj) => this.scene.remove(obj));
    this.obstacles = [];
  }

  gameOver() {
    this.isPlaying = false;
    document.getElementById("final-score").innerText = Math.floor(this.score);
    document.getElementById("game-over-screen").style.display = "flex";

    // 플레이어 숨기고 폭발 효과 (간략히)
    this.player.visible = false;
  }

  spawnObstacle() {
    // 장애물: 빛나는 기둥
    const height = Math.random() * 3 + 1;
    const geometry = new THREE.BoxGeometry(1, height, 1);
    const material = new THREE.MeshPhongMaterial({
      color: 0x000000,
      emissive: this.colors.obstacle,
      emissiveIntensity: 1,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // 위치 설정 (멀리서 생성되어 다가옴)
    mesh.position.x = (Math.random() - 0.5) * 20; // 좌우 폭 -10 ~ 10
    mesh.position.y = height / 2 - 0.5;
    mesh.position.z = -100; // 카메라 앞 100 거리에서 생성

    this.scene.add(mesh);
    this.obstacles.push(mesh);
  }

  update(delta) {
    if (!this.isPlaying) return;

    // 1. 점수 및 속도 관리
    this.speed += delta * 1.5; // 시간이 지날수록 빨라짐
    const moveStep = this.speed * delta;
    this.score += moveStep;

    // UI 업데이트
    document.getElementById("score").innerText = Math.floor(this.score);
    document.getElementById("speed").innerText = Math.floor(this.speed * 3);

    // 2. 플레이어 이동 (마우스 따라가기)
    // Lerp를 사용하여 부드럽게 이동
    this.player.position.x += (this.targetX - this.player.position.x) * 0.15;

    // 회전 효과 (이동하는 방향으로 기체가 기울어짐)
    const tilt = (this.player.position.x - this.targetX) * 0.08;
    this.player.rotation.z = tilt;
    this.player.rotation.y = -tilt * 0.5;

    // 3. 바닥 움직임 (무한 스크롤 착시)
    // 그리드를 실제로 움직이는 대신 텍스처나 위치를 반복시킴
    // 여기서는 장애물이 다가오는 방식을 쓰므로 바닥도 시각적으로 맞춰줌
    this.floor.position.z += moveStep;
    if (this.floor.position.z > 10) this.floor.position.z = 0;

    // 4. 장애물 관리
    // 생성 확률 (속도가 빠를수록 더 자주 나옴)
    if (Math.random() < 0.05 + this.speed * 0.0005) {
      this.spawnObstacle();
    }

    // 장애물 이동 및 충돌 검사
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      obs.position.z += moveStep; // 플레이어 쪽으로 이동

      // 충돌 검사 (간단한 거리 계산)
      // Z축이 가까워졌을 때 + X축이 겹칠 때
      if (obs.position.z > 0 && obs.position.z < 2) {
        const xDiff = Math.abs(this.player.position.x - obs.position.x);
        if (xDiff < 1.0) {
          // 충돌 범위
          this.gameOver();
        }
      }

      // 화면 밖으로 나가면 제거
      if (obs.position.z > 10) {
        this.scene.remove(obs);
        this.obstacles.splice(i, 1);
      }
    }
  }

  onMouseMove(e) {
    if (!this.isPlaying) return;
    // 마우스 위치를 -1 ~ 1 사이 값으로 정규화
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    // 게임 내 이동 범위 (-10 ~ 10)로 변환
    this.targetX = x * 10;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.update(0.016); // 약 60fps 가정
    this.renderer.render(this.scene, this.camera);
  }
}

// 게임 실행
const game = new NeonRaceGame();
