import * as THREE from 'three';
import { MAP, TILE, LIGHT_COLORS, SCAN_TIME } from './level.js';
import { makeFlashlight, makeKey, makeScroll, makeRobotHands } from './props3d.js';

const UNIT = 3, HEIGHT = 3.3;
const world = value => value / TILE * UNIT;

function surface(kind) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d');
  c.fillStyle = kind === 'wall' ? '#a49a60' : kind === 'floor' ? '#655c3e' : '#b2ae91'; c.fillRect(0, 0, 256, 256);
  let seed = 71;
  for (let i = 0; i < 18000; i++) {
    seed = (seed * 16807) % 2147483647; const x = seed % 256;
    seed = (seed * 16807) % 2147483647; const y = seed % 256;
    c.fillStyle = i % 2 ? '#ffffff0b' : '#17150d15'; c.fillRect(x, y, 1, kind === 'wall' ? 3 : 1);
  }
  if (kind === 'wall') {
    c.strokeStyle = '#534e242a'; c.lineWidth = 1;
    for (let x = 0; x < 256; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 256); c.stroke(); }
    for (let y = 12; y < 240; y += 28) for (let x = 8; x < 256; x += 32) {
      c.beginPath(); c.ellipse(x, y, 5, 10, 0, 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = '#393623'; c.fillRect(0, 241, 256, 15);
    c.fillStyle = '#d0c28a'; c.fillRect(0, 238, 256, 3);
  } else if (kind === 'ceiling') {
    c.strokeStyle = '#676451'; c.lineWidth = 3; c.strokeRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createScene3D(host) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#343321');
  scene.fog = new THREE.FogExp2('#383724', 0.032);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Live 3D Backrooms view following the player');
  host.replaceChildren(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(108, 1, 0.05, 110);
  const wallMap = surface('wall'), floorMap = surface('floor'), ceilingMap = surface('ceiling');
  const wallMaterial = new THREE.MeshStandardMaterial({ map: wallMap, roughness: 0.98 });
  const floorMaterial = new THREE.MeshStandardMaterial({ map: floorMap, roughness: 1 });
  const ceilingMaterial = new THREE.MeshStandardMaterial({ map: ceilingMap, roughness: 1 });
  const fillLight = new THREE.HemisphereLight(0x8a8d6b, 0x161a12, 0.045);
  scene.add(fillLight);
  // One stable flashlight beam is the only strong light. The old player point
  // light illuminated the whole level and made the renderer pulse visually.
  const flashlight = new THREE.SpotLight(0xfff4c6, 0, 18, Math.PI / 4, 0.52, 1.2);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(512, 512);
  scene.add(flashlight, flashlight.target);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const box = (x, y, z, w, h, d, material) => {
    const mesh = new THREE.Mesh(boxGeometry, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
  };
  const material = color => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const dark = material('#302f25'), metal = material('#586861'), doorMat = material('#736345');
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff5ce' });
  const tiles = [], walls = [], lamps = [], doors = [], objects = [], bulbs = [];
  MAP.forEach((row, y) => [...row].forEach((cell, x) => {
    const px = (x + 0.5) * UNIT, pz = (y + 0.5) * UNIT;
    if (cell === '#') { walls.push([px, HEIGHT / 2, pz]); return; }
    tiles.push([px, pz]);
    if ((x % 4 === 2 && y % 3 === 2) || (y === 1 && x % 4 === 2)) lamps.push([px, pz]);
    if ('ALG'.includes(cell) || (y === 9 && [4, 12, 20].includes(x))) {
      const mesh = box(px, HEIGHT / 2, pz, UNIT, HEIGHT, 0.24, doorMat);
      doors.push({ mesh, cell });
    }
    if ('CRDKES'.includes(cell)) objects.push({ cell, x: px, z: pz });
    if ('1234'.includes(cell)) {
      const mat = new THREE.MeshStandardMaterial({color: LIGHT_COLORS[cell], emissive: LIGHT_COLORS[cell], emissiveIntensity: 0.2});
      const mesh = box(px, 1.8, pz - 1.2, 0.65, 0.65, 0.18, mat); bulbs.push({ cell, mesh });
    }
    if (cell === 'T') box(px, 0.01, pz, 2.9, 0.04, 2.9, dark);
  }));
  const instances = (positions, scale, mat) => {
    const mesh = new THREE.InstancedMesh(boxGeometry, mat, positions.length), dummy = new THREE.Object3D();
    positions.forEach((pos, i) => { dummy.position.set(...pos); dummy.scale.set(...scale); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
  };
  instances(walls, [UNIT, HEIGHT, UNIT], wallMaterial);
  instances(tiles.map(([x,z]) => [x,-0.06,z]), [UNIT,0.12,UNIT], floorMaterial);
  instances(tiles.map(([x,z]) => [x,HEIGHT+0.06,z]), [UNIT,0.12,UNIT], ceilingMaterial);
  instances(lamps.map(([x,z]) => [x,HEIGHT-0.055,z]), [1.5,0.08,0.65], dark);
  instances(lamps.map(([x,z]) => [x,HEIGHT-0.105,z]), [1.36,0.025,0.48], lampMat);
  const labels = [];
  const sign = (text, x, y, z, color = '#d7e6c0') => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const ctx = c.getContext('2d'); ctx.fillStyle = text === 'EXIT' ? '#b31324' : '#181e18'; ctx.fillRect(0,0,512,128);
    ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.strokeRect(7,7,498,114);
    ctx.fillStyle = color; ctx.font = 'bold 32px monospace'; ctx.textAlign = 'center'; ctx.fillText(text,256,76);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:texture})); sprite.position.set(x,y,z); sprite.scale.set(2.5,0.625,1); scene.add(sprite); labels.push(sprite); return sprite;
  };
  let keyMesh, keySign, scrollMesh, scrollSign, exitDoor, exitPosition;
  let exitOpen = 0;
  const flashlightItem = makeFlashlight();
  flashlightItem.position.set(world(2 * TILE + TILE / 2), 0.42, world(1 * TILE + TILE / 2));
  flashlightItem.rotation.x = -0.18;
  scene.add(flashlightItem);
  const hands = makeRobotHands(); hands.position.set(0, -0.08, 0); hands.scale.setScalar(.58); camera.add(hands); scene.add(camera);
  const names = { C:'01 / LIGHT SEQUENCE', R:'02 / SYMBOL MEMORY', D:'06 / CALCULUS FILE', K:'04 / KEY', E:'07 / EXIT', S:'SAFE ZONE' };
  for (const obj of objects) {
    if (obj.cell === 'S') { box(obj.x,0.02,obj.z,2.7,0.04,2.7,material('#3c7760')); continue; }
    if (obj.cell === 'E') {
      // East-facing doorway at the boundary, rather than a slab in the tile's center.
      exitPosition = new THREE.Vector3(obj.x + 1.30, 0, obj.z);
      const doorway = new THREE.Group();
      doorway.position.copy(exitPosition); doorway.rotation.y = -Math.PI / 2;
      scene.add(doorway);
      const part = (parent, px, py, pz, w, h, d, mat) => {
        const mesh = new THREE.Mesh(boxGeometry, mat);
        mesh.position.set(px,py,pz); mesh.scale.set(w,h,d);
        mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
      };
      const frame = material('#393d3d'), steel = material('#727b7b');
      part(doorway,0,1.36,-.17,1.95,2.72,.08,new THREE.MeshBasicMaterial({color:'#fff0c9'}));
      for (const side of [-1,1]) part(doorway,side*1.02,1.4,0,.13,2.8,.24,frame);
      part(doorway,0,2.82,0,2.17,.16,.24,frame);
      exitDoor = new THREE.Group(); exitDoor.position.set(-.94,0,.03); doorway.add(exitDoor);
      part(exitDoor,.94,1.35,0,1.86,2.7,.10,steel);
      part(exitDoor,.94,1.14,.09,1.42,.11,.12,frame);
      part(exitDoor,.94,1.91,.063,.58,.58,.02,frame);
      part(exitDoor,.94,1.91,.078,.46,.46,.01,new THREE.MeshBasicMaterial({color:'#aabbb8'}));
      for (const y of [.28,2.4]) part(exitDoor,0,y,.06,.09,.18,.12,frame);
      const exitLabel = sign('EXIT',0,0,0,'#ffffff');
      const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.36,.34),
        new THREE.MeshBasicMaterial({map:exitLabel.material.map}));
      scene.remove(exitLabel); doorway.add(exitLabel); exitLabel.visible=false;
      signMesh.position.set(0,3.08,.15); doorway.add(signMesh);
      continue;
    }
    const label = sign(obj.cell === 'E' ? 'EXIT' : names[obj.cell],obj.x,2.35,obj.z, obj.cell === 'E' ? '#ffffff' : '#d7e6c0');
    if ('CR'.includes(obj.cell)) {
      box(obj.x,0.65,obj.z,1.05,1.3,0.6,metal);
      box(obj.x,1.4,obj.z,1.13,0.4,0.65,dark);
      box(obj.x,1.43,obj.z-0.34,0.82,0.21,0.03,new THREE.MeshBasicMaterial({color:'#b4a86d'}));
    } else if (obj.cell === 'K') {
      keyMesh = makeKey(); keyMesh.position.set(obj.x,1.0,obj.z); scene.add(keyMesh); keySign = label;
    } else if (obj.cell === 'D') {
      scrollMesh = makeScroll(); scrollMesh.position.set(obj.x,0.85,obj.z); scene.add(scrollMesh); scrollSign = label;
    }
  }
  for (const [x,text] of [[4,'LEFT'],[12,'CENTER'],[20,'RIGHT']]) sign(`03 / ${text}`, (x+0.5)*UNIT,2.5,9.5*UNIT);
  const monster = new THREE.Group();
  // Creature: tall gaunt humanoid, dark matte skin, red glowing eyes
  const skinMat = new THREE.MeshStandardMaterial({color:'#181210', roughness:.9, emissive:'#0a0806', emissiveIntensity:.5});
  // Legs — root at y=0, go up to y=1.1
  for (const sx of [-0.18, 0.18]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.26,1.1,.26), skinMat);
    leg.position.set(sx, 0.55, 0); monster.add(leg);
  }
  // Torso — sits on top of legs, y=1.1 to y=2.7
  const torso = new THREE.Mesh(new THREE.BoxGeometry(.68,1.6,.38), skinMat);
  torso.position.y = 1.9; monster.add(torso);
  // Arms — hang from shoulder (~y=2.5), down to ~y=1.2
  for (const sx of [-0.42, 0.42]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.20,1.3,.20), skinMat);
    arm.position.set(sx, 1.75, 0); monster.add(arm);
  }
  // Head — elongated, sits at y=2.7 to y=3.45
  const head = new THREE.Mesh(new THREE.BoxGeometry(.56,.75,.46), skinMat);
  head.position.y = 3.08; monster.add(head);
  // Eyes — in the face, at y≈3.08, front face z=-0.23
  const eyeMat = new THREE.MeshBasicMaterial({color:'#ff2200'});
  for (const ex of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07,10,8), eyeMat);
    eye.position.set(ex, 3.10, -0.24); monster.add(eye);
    const eg = new THREE.PointLight(0xff2200, 2.0, 2.5, 2); eg.position.copy(eye.position); monster.add(eg);
  }
  // Ambient red glow
  const monsterGlow = new THREE.PointLight(0xff1a00, 3, 7, 2); monsterGlow.position.set(0, 1.8, 0); monster.add(monsterGlow);
  scene.add(monster);
  // Same corridor the minimap marks as BLOCKED (tile x=12, y=10..14)
  const blockedSign = sign('⛔ BLOCKED · MONSTER', 12.5 * UNIT, 2.5, 12 * UNIT, '#e0604e');
  const blockedTape = new THREE.Mesh(new THREE.PlaneGeometry(UNIT, 0.18),
    new THREE.MeshBasicMaterial({ color: '#d4402e', side: THREE.DoubleSide }));
  blockedTape.position.set(12.5 * UNIT, 1.2, 12 * UNIT);
  scene.add(blockedTape);
  blockedSign.scale.set(4.4, 1.1, 1);
  blockedSign.visible = blockedTape.visible = false;
  let previous = null, yaw = 0, targetYaw = 0, lastAt = 0, lastPickup = 0, grabUntil = 0;
  let previousDoors = null, doorFlashUntil = 0;
  const resize = () => { const w = Math.max(1,host.clientWidth), h = Math.max(1,host.clientHeight); renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  return {
    draw(s) {
      const now = performance.now(), dt = Math.min(0.1,(now-lastAt)/1000 || 0.016); lastAt=now;
      const x=world(s.player.x), z=world(s.player.y);
      if (!previous) { yaw=targetYaw=Math.atan2(world(s.lightConsole.x)-x,world(s.lightConsole.y)-z); }
      else if (Math.hypot(x-previous.x,z-previous.z)>0.002) targetYaw=Math.atan2(x-previous.x,z-previous.z);
      if (s.modal) {
        const target = s.modal === 'lights' ? s.lightConsole : s.modal === 'memory' ? s.memoryConsole : null;
        if (target && Math.hypot(world(target.x)-x,world(target.y)-z)>0.1) targetYaw=Math.atan2(world(target.x)-x,world(target.y)-z);
      }
      yaw += Math.atan2(Math.sin(targetYaw-yaw),Math.cos(targetYaw-yaw)) * (1-Math.exp(-dt*8));
      previous={x,z};
      let cameraX=x, cameraZ=z;
      if (s.modal) {
        // Keep the camera behind the console instead of clipping into its mesh.
        const backX=x-Math.sin(yaw)*2.4, backZ=z-Math.cos(yaw)*2.4;
        if (s.canEnter(Math.floor(backX/UNIT),Math.floor(backZ/UNIT))) { cameraX=backX; cameraZ=backZ; }
      }
      camera.position.set(cameraX,2.08,cameraZ);
      camera.lookAt(x+Math.sin(yaw)*(s.modal?1.8:7.5),s.modal?1.48:1.65,z+Math.cos(yaw)*(s.modal?1.8:7.5));
      if (exitDoor) {
        exitOpen = THREE.MathUtils.damp(exitOpen, s.won ? 1 : 0, 3, dt);
        exitDoor.rotation.y = -exitOpen * Math.PI * .48;
        if (s.won) {
          camera.position.set(exitPosition.x-3.8,1.85,exitPosition.z);
          camera.lookAt(exitPosition.x,1.65,exitPosition.z);
        }
      }
      const beamOrigin = camera.position.clone();
      flashlight.position.copy(beamOrigin);
      flashlight.target.position.set(x+Math.sin(yaw)*8, 0.55, z+Math.cos(yaw)*8);
      if (s.won && exitPosition) flashlight.target.position.set(exitPosition.x,1.5,exitPosition.z);
      flashlight.visible = Boolean(s.hasFlashlight);
      hands.visible = Boolean(s.hasFlashlight);
      hands.userData.scroll.visible = Boolean(s.hasDocument && !s.documentAnswered);
      if (s.pickupSequence !== lastPickup) { lastPickup = s.pickupSequence; grabUntil = now + 520; }
      const grabbing = now < grabUntil;
      const openState = `${s.firstGateOpen}-${s.lockOpen}-${s.gateOpen}`;
      if (previousDoors !== null && openState !== previousDoors) doorFlashUntil = now + 1400;
      previousDoors = openState;
      const activity = document.getElementById('scene-activity');
      if (activity) {
        activity.textContent = now < doorFlashUntil ? 'DOOR OPEN' : (s.monsterActive ? 'MONSTER DETECTED · ROUTE BLOCKED' : (s.message || 'LIVE 3D / PLAYER POV'));
        activity.dataset.doorOpen = now < doorFlashUntil ? 'true' : 'false';
      }
      const pickupProgress = grabbing ? 1 - (grabUntil - now) / 520 : 1;
      const pickupEase = pickupProgress < .5 ? 2 * pickupProgress * pickupProgress : 1 - Math.pow(-2 * pickupProgress + 2, 2) / 2;
      // Reach forward, close the hand, then settle back into the POV pose.
      hands.position.y = grabbing ? -0.08 + Math.sin(pickupEase * Math.PI) * .10 : -0.08;
      hands.position.z = grabbing ? -Math.sin(pickupEase * Math.PI) * .12 : 0;
      hands.rotation.z = grabbing ? .045 * Math.sin(pickupEase * Math.PI) : 0;
      hands.rotation.x = grabbing ? -.10 * Math.sin(pickupEase * Math.PI) : 0;
      flashlight.intensity = s.hasFlashlight ? 18 * (grabbing ? pickupEase : 1) : 0;
      const isAlarm = s.monsterActive && s.alarmRemaining > 0;
      blockedSign.visible = blockedTape.visible = s.blockedPath === 'CENTER';
      if (s.scanRemaining > 0 && s.hasFlashlight) {
        // One full 360° turn with the torch; camera, beam and hands rotate together.
        const progress = 1 - s.scanRemaining / SCAN_TIME;
        const eased = progress * progress * (3 - 2 * progress);
        const scanYaw = yaw + eased * Math.PI * 2;
        camera.lookAt(x+Math.sin(scanYaw)*7.5, 1.65, z+Math.cos(scanYaw)*7.5);
        flashlight.target.position.set(x + Math.sin(scanYaw)*8, 0.75, z + Math.cos(scanYaw)*8);
        hands.rotation.y = 0;
      } else {
        hands.rotation.y = 0;
      }
      fillLight.intensity = s.hasFlashlight ? (grabbing ? .045 + .055 * pickupEase : .10) : .035;
      hands.scale.setScalar(grabbing ? .62 : .58);
      flashlightItem.visible = !s.hasFlashlight;
      hands.userData.torch.visible = Boolean(s.hasFlashlight);
      for (const {mesh,cell} of doors) mesh.visible= !(cell==='A'?s.firstGateOpen:cell==='L'?s.lockOpen:cell==='G'?s.gateOpen:s.memorySolved);
      for (const {cell,mesh} of bulbs) mesh.material.emissiveIntensity=Number(cell)===s.activeLight?3:0.15;
      if (keyMesh) keyMesh.visible=keySign.visible=!s.hasKey;
      if (scrollMesh) scrollMesh.visible=scrollSign.visible=Boolean(!s.hasDocument && !s.documentAnswered);
      monster.visible=s.monsterActive;
      monster.position.set(world(s.monster.x),0,world(s.monster.y));
      monster.lookAt(x,0,z);
      renderer.domElement.dataset.position=`${s.player.x.toFixed(1)},${s.player.y.toFixed(1)}`;
      renderer.render(scene,camera);
    },
    destroy() {
      observer.disconnect();
      const geometries=new Set(), materials=new Set(), textures=new Set();
      scene.traverse(obj=>{if(obj.geometry) geometries.add(obj.geometry); if(obj.material) for(const mat of Array.isArray(obj.material)?obj.material:[obj.material]) materials.add(mat);});
      for(const mat of materials){if(mat.map) textures.add(mat.map);mat.dispose();}
      for(const geo of geometries)geo.dispose(); for(const texture of textures)texture.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
