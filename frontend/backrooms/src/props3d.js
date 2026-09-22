import * as THREE from 'three';
const metal = (color) => new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.55 });
const part = (group, geometry, material, position, rotation = [0,0,0]) => {
  const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.rotation.set(...rotation); group.add(mesh); return mesh;
};

export function makeFlashlight() {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({color:'#7b858b', metalness:.30, roughness:.42, emissive:'#111518', emissiveIntensity:.12});
  const grip = new THREE.MeshStandardMaterial({color:'#252a2d', metalness:.05, roughness:.85});
  part(group,new THREE.CylinderGeometry(.052,.062,.34,20),body,[0,0,0],[Math.PI/2,0,0]);
  part(group,new THREE.CylinderGeometry(.088,.076,.11,20),body,[0,0,-.22],[Math.PI/2,0,0]);
  const lens = new THREE.MeshStandardMaterial({color:'#87918d',emissive:'#64716c',emissiveIntensity:.035,roughness:.38});
  part(group,new THREE.CylinderGeometry(.072,.072,.012,20),lens,[0,0,-.284],[Math.PI/2,0,0]);
  part(group,new THREE.TorusGeometry(.074,.009,8,20),grip,[0,0,-.278],[Math.PI/2,0,0]);
  for (const z of [-.12,-.06,0,.06,.12]) part(group,new THREE.TorusGeometry(.061,.006,8,16),grip,[0,0,z],[Math.PI/2,0,0]);
  part(group,new THREE.BoxGeometry(.035,.018,.05),grip,[0,.06,.025]);
  group.userData.lens = lens;
  return group;
}

export function makeKey() {
  const group = new THREE.Group(), brass = metal('#c7a15a');
  part(group,new THREE.TorusGeometry(.16,.045,8,24),brass,[0,.27,0]);
  part(group,new THREE.BoxGeometry(.075,.45,.075),brass,[0,-.10,0]);
  part(group,new THREE.BoxGeometry(.19,.065,.075),brass,[.06,-.28,0]);
  part(group,new THREE.BoxGeometry(.14,.065,.075),brass,[.035,-.17,0]);
  group.rotation.z=-.55;
  return group;
}

export function makeScroll() {
  const group = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({color:'#cfbf91',roughness:1});
  const edges = new THREE.MeshStandardMaterial({color:'#978867',roughness:1});
  // Two rolled ends with a thin parchment sheet between them: unmistakably a
  // map scroll, rather than a rectangular prop.
  part(group,new THREE.BoxGeometry(.58,.018,.25),paper,[0,0,0]);
  for(const x of [-.35,.35]) {
    part(group,new THREE.CylinderGeometry(.105,.105,.15,24),paper,[x,0,0],[0,0,Math.PI/2]);
    part(group,new THREE.TorusGeometry(.075,.018,8,20),edges,[x,0,0],[0,Math.PI/2,0]);
  }
  // A tiny hand-drawn adventure map is wrapped around the paper so the pickup
  // reads as a real scroll rather than a generic blue interaction block.
  const map = document.createElement('canvas'); map.width = 256; map.height = 128;
  const ctx = map.getContext('2d'); ctx.fillStyle = '#d8c58e'; ctx.fillRect(0,0,256,128);
  ctx.strokeStyle = '#85704d'; ctx.lineWidth = 4; ctx.strokeRect(8,8,240,112);
  ctx.strokeStyle = '#6b7a55'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(22,96); ctx.quadraticCurveTo(75,20,125,80); ctx.quadraticCurveTo(170,120,230,30); ctx.stroke();
  ctx.fillStyle = '#9b654a'; for (const [x,y] of [[50,34],[114,87],[205,48]]) { ctx.beginPath(); ctx.arc(x,y,7,0,Math.PI*2); ctx.fill(); }
  const mapTexture = new THREE.CanvasTexture(map); mapTexture.colorSpace = THREE.SRGBColorSpace;
  const mapPanel = new THREE.Mesh(new THREE.PlaneGeometry(.46,.22), new THREE.MeshStandardMaterial({map:mapTexture, roughness:.9, side:THREE.DoubleSide}));
  mapPanel.position.set(0,.012,-.13); group.add(mapPanel);
  group.rotation.y=.2;
  return group;
}

export function makeRobotHands() {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({color:'#9b5d47', metalness:0, roughness:.82, emissive:'#100403', emissiveIntensity:.05});
  const skinLight = new THREE.MeshStandardMaterial({color:'#c17b5c', metalness:0, roughness:.78, emissive:'#160604', emissiveIntensity:.04});
  const connect = (a,b,nearRadius,farRadius,material) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start), length = delta.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(farRadius,nearRadius,length,14), material);
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize());
    return mesh;
  };
  const handMesh = (side, material) => {
    // One continuous, bevelled hand silhouette: palm, four fingers and thumb
    // are part of the same mesh instead of separate balls or blocks.
    const shape = new THREE.Shape();
    const p = side > 0 ? 1 : -1;
    shape.moveTo(-.075*p,-.10); shape.lineTo(.075*p,-.10);
    shape.quadraticCurveTo(.115*p,-.045,.10*p,.015);
    shape.lineTo(.092*p,.115); shape.quadraticCurveTo(.09*p,.145,.075*p,.145);
    shape.quadraticCurveTo(.058*p,.145,.057*p,.115); shape.lineTo(.052*p,.06);
    shape.lineTo(.042*p,.17); shape.quadraticCurveTo(.04*p,.20,.022*p,.20);
    shape.quadraticCurveTo(.005*p,.20,.004*p,.17); shape.lineTo(0,.065);
    shape.lineTo(-.012*p,.185); shape.quadraticCurveTo(-.014*p,.215,-.031*p,.215);
    shape.quadraticCurveTo(-.047*p,.215,-.047*p,.183); shape.lineTo(-.048*p,.06);
    shape.lineTo(-.062*p,.165); shape.quadraticCurveTo(-.068*p,.19,-.084*p,.185);
    shape.quadraticCurveTo(-.10*p,.18,-.096*p,.15); shape.lineTo(-.09*p,.035);
    shape.quadraticCurveTo(-.16*p,.08,-.19*p,.045); shape.quadraticCurveTo(-.21*p,.018,-.18*p,-.005);
    shape.lineTo(-.10*p,-.075); shape.quadraticCurveTo(-.09*p,-.10,-.075*p,-.10);
    const geo = new THREE.ExtrudeGeometry(shape,{depth:.065,bevelEnabled:true,bevelSegments:3,bevelSize:.010,bevelThickness:.009,curveSegments:5});
    geo.translate(0,0,-.0325); return new THREE.Mesh(geo,material);
  };
  const makeHand = (side) => {
    const hand = new THREE.Group();
    const handPoint = [side*.25,-.30,-.85];
    hand.position.set(...handPoint);
    hand.rotation.set(-.35, side*.08, -side*.10);
    const palm = handMesh(side,skin); palm.position.set(0,0,-.24); hand.add(palm);
    group.add(hand);return hand;
  };
  const right=makeHand(1); const left=makeHand(-1);
  group.add(connect([-.42,-.55,-.25],[-.25,-.30,-.85],.085,.050,skin));
  group.add(connect([.42,-.55,-.25],[.25,-.30,-.85],.085,.050,skin));
  const pants = new THREE.MeshStandardMaterial({color:'#24251f', roughness:.95});
  const boot = new THREE.MeshStandardMaterial({color:'#171815', roughness:.9});
  for (const side of [-1,1]) {
    part(group,new THREE.CylinderGeometry(.115,.14,1.05,12),pants,[side*.16,-1.02,.20],[0,0,side*.035]);
    part(group,new THREE.CapsuleGeometry(.12,.28,6,10),boot,[side*.16,-1.62,-.02],[0,0,side*.03]);
  }
  const torch=makeFlashlight();
  // Held forward of the palm so the gray cylindrical body is readable in POV.
  torch.scale.setScalar(1.65); torch.position.set(.035,-.035,-.94); torch.rotation.y=.26; right.add(torch);
  const scroll=makeScroll(); scroll.position.set(0,.08,-.03); scroll.rotation.z=-.18; left.add(scroll);
  group.userData.torch= torch; group.userData.scroll = scroll;
  return group;
}
