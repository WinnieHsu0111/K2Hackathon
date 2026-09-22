import { MAP, TILE } from './level.js';
import { missionState, STAGES } from './mission.js';

export function createMinimap() {
  const canvas = document.getElementById('minimap-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 320; canvas.height = 250;
  const cell = 8, ox = 6, oy = 12;
  const zones = [2,6,11,14.5,16.5,20,24.5];
  return { draw(s) {
    ctx.fillStyle = '#11170f'; ctx.fillRect(0,0,320,250);
    const {index} = missionState(s);
    MAP.forEach((row,y)=>[...row].forEach((char,x)=>{
      if (char === '#') return;
      ctx.fillStyle=s.canEnter(x,y)?'#37432e':'#82734b';
      ctx.fillRect(ox+x*cell,oy+y*cell,cell-0.4,cell-0.4);
    }));
    ctx.font='9px monospace'; ctx.textBaseline='middle';
    zones.forEach((y,i)=>{
      const py=oy+y*cell;
      ctx.strokeStyle=i===index?'#d3cc86':'#384830'; ctx.beginPath();ctx.moveTo(208,py);ctx.lineTo(219,py);ctx.stroke();
      ctx.fillStyle=STAGES[i].complete(s)?'#91ac7b':i===index?'#f3dfa1':'#748465';
      ctx.fillText(`${i+1} ${STAGES[i].short}`,224,py);
    });
    const dot=(p,color,r=3,label='')=>{
      const px=ox+p.x/TILE*cell, py=oy+p.y/TILE*cell;
      ctx.fillStyle=color;ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);ctx.fill();
      if(label){ ctx.font='bold 8px monospace'; ctx.textAlign='center'; ctx.textBaseline='bottom';
        const w=ctx.measureText(label).width+6; ctx.fillStyle='#11170fe8'; ctx.fillRect(px-w/2,py-r-12,w,11);
        ctx.fillStyle=color; ctx.fillText(label,px,py-r-3); ctx.textAlign='start'; }
    };
    if (!s.hasKey) dot(s.key,'#cabb67',2,'KEY');
    if (s.monsterActive) dot(s.monster,'#f17e67',3,'MONSTER');
    dot(s.exit,'#96c9a1',3,'EXIT');dot(s.player,'#f6e6b2',3.5,'K2');
    ctx.strokeStyle='#f6e6b255';ctx.lineWidth=2;ctx.beginPath();ctx.arc(ox+s.player.x/TILE*cell,oy+s.player.y/TILE*cell,7,0,Math.PI*2);ctx.stroke();
  }};
}
