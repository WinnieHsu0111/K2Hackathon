import Phaser from 'phaser';
import './style.css';

// 地圖每列要一樣長：# 牆壁、. 地板、P 出生點、E 出口。
const MAP = [
  '#########################',
  '#P......#...............#',
  '#.......#.....#.........#',
  '#.............#.........#',
  '#####.#########.#####.###',
  '#.....#.........#.......#',
  '#.....#.........#.......#',
  '#...............#.......#',
  '#.#########.#####.#####.#',
  '#.........#.............#',
  '#.........#.....#.......#',
  '#...............#.......#',
  '###.###########.#####.###',
  '#......................E#',
  '#########################',
];
const TILE = 48;
const WALK_SPEED = 145;
const RUN_SPEED = 220;
const status = document.querySelector('#status');
const HELP = '找到綠色出口。WASD／方向鍵移動 · Shift 奔跑 · R 重來';

class Backrooms extends Phaser.Scene {
  constructor() {
    super('Backrooms');
  }

  create() {
    this.won = false;
    status.textContent = HELP;
    this.physics.resume();
    const width = MAP[0].length * TILE;
    const height = MAP.length * TILE;
    this.physics.world.setBounds(0, 0, width, height);
    const walls = this.physics.add.staticGroup();

    MAP.forEach((row, y) => [...row].forEach((cell, x) => {
      const px = x * TILE + TILE / 2;
      const py = y * TILE + TILE / 2;
      if (cell === '#') {
        const wall = this.add.rectangle(px, py, TILE, TILE, 0x8d8249);
        wall.setStrokeStyle(2, 0x645b31);
        walls.add(wall); // StaticGroup 會替牆壁建立碰撞體。
        this.add.rectangle(px, py + 17, TILE - 4, 8, 0x716739);
      } else {
        this.add.rectangle(px, py, TILE, TILE, (x + y) % 2 ? 0x655d36 : 0x6b6239)
          .setStrokeStyle(1, 0x595132);
        if (cell === 'P') this.spawn = { x: px, y: py };
        if (cell === 'E') {
          this.exit = this.add.rectangle(px, py, 32, 32, 0x80be92).setDepth(1);
          this.physics.add.existing(this.exit, true);
        }
      }
    }));

    this.player = this.add.rectangle(this.spawn.x, this.spawn.y, 20, 20, 0xede4bd)
      .setStrokeStyle(2, 0x302c1a).setDepth(2);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, walls);
    this.physics.add.overlap(this.player, this.exit, () => {
      if (this.won) return;
      this.won = true;
      this.player.body.setVelocity(0, 0);
      this.physics.pause();
      status.textContent = '你找到了出口。這裡真的是出口嗎？按 R 再玩一次。';
      this.add.text(480, 288, 'LEVEL 0 COMPLETE', {
        fontFamily: 'monospace', fontSize: '30px', color: '#eee6ba',
        backgroundColor: '#171710', padding: { x: 24, y: 16 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SHIFT,R');
    this.direction = new Phaser.Math.Vector2();
    const camera = this.cameras.main;
    camera.setBounds(0, 0, width, height);
    camera.startFollow(this.player, true);

    // 預先產生漸層遮罩，每幀只移動位置，避免每幀重畫整張材質。
    // 這是圓形視野效果；牆壁尚未遮擋光線。
    if (!this.textures.exists('darkness')) {
      const size = 2048;
      const texture = this.textures.createCanvas('darkness', size, size);
      const ctx = texture.context;
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 45, size / 2, size / 2, 190);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(0.65, 'rgba(0, 0, 0, 0.45)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.98)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      texture.refresh();
    }
    this.darkness = this.add.image(this.player.x, this.player.y, 'darkness').setDepth(10);
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      this.scene.restart();
      return;
    }
    if (this.won) return;

    const x = Number(this.keys.D.isDown || this.cursors.right.isDown)
      - Number(this.keys.A.isDown || this.cursors.left.isDown);
    const y = Number(this.keys.S.isDown || this.cursors.down.isDown)
      - Number(this.keys.W.isDown || this.cursors.up.isDown);
    const speed = this.keys.SHIFT.isDown ? RUN_SPEED : WALK_SPEED;
    // 正規化方向向量，避免斜走比直走更快。速度單位是 pixels/second。
    this.direction.set(x, y).normalize().scale(speed);
    this.player.body.setVelocity(this.direction.x, this.direction.y);
    this.darkness.setPosition(this.player.x, this.player.y);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 576,
  backgroundColor: '#15150f',
  pixelArt: true,
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [Backrooms],
});

// 修改檔案時銷毀舊遊戲，避免開發期間累積多個 canvas 與鍵盤事件。
if (import.meta.hot) import.meta.hot.dispose(() => game.destroy(true));
