"use strict";

const crypto = require("node:crypto");
const {
  normalizeStrokes,
  strokesToSvg,
  makeAsciiGrid
} = require("./ai-companion-frontend/shared/drawing-protocol");

const ASCII_NOTE = "60×42 字符网格；█ 表示画笔经过的位置，空格表示留白。";
const PRESETS = Object.freeze([
  { answer: "猫", aliases: ["小猫", "猫咪"], strokes: [[[210,250],[250,190],[290,250]],[[310,250],[350,190],[390,250]],[[220,250],[220,340],[380,340],[380,250],[220,250]],[[270,285],[272,285]],[[330,285],[332,285]],[[285,315],[300,325],[315,315]]] },
  { answer: "小狗", aliases: ["狗", "狗狗"], strokes: [[[220,230],[180,190],[190,285]],[[380,230],[420,190],[410,285]],[[210,230],[220,345],[380,345],[390,230],[210,230]],[[270,285],[272,285]],[[330,285],[332,285]],[[285,315],[300,330],[315,315]]] },
  { answer: "月亮", aliases: ["月牙"], strokes: [[[350,100],[270,130],[230,210],[250,300],[330,345],[410,320],[455,250],[390,275],[325,250],[295,190],[310,135],[350,100]]] },
  { answer: "伞", aliases: ["雨伞"], strokes: [[[150,230],[220,140],[300,110],[380,140],[450,230],[150,230]],[[300,110],[300,340],[330,360],[350,340]]] },
  { answer: "房子", aliases: ["小屋"], strokes: [[[150,235],[300,105],[450,235]],[[190,215],[190,365],[410,365],[410,215]],[[270,365],[270,285],[330,285],[330,365]]] },
  { answer: "花", aliases: ["花朵"], strokes: [[[300,205],[260,165],[220,205],[260,245],[300,205],[340,165],[380,205],[340,245],[300,205]],[[300,245],[300,370]],[[300,315],[250,290]],[[300,335],[350,305]]] },
  { answer: "鱼", aliases: ["小鱼"], strokes: [[[170,230],[260,160],[370,175],[430,230],[370,285],[260,300],[170,230]],[[170,230],[105,175],[105,285],[170,230]],[[350,220],[354,220]]] }
]);

function normalizeGuess(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN").replace(/[\s，。！？、,.!?]/g, "");
}

class DrawGameService {
  constructor({ maxRounds = 100, now = () => new Date(), random = Math.random } = {}) {
    this.maxRounds = maxRounds;
    this.now = now;
    this.random = random;
    this.rounds = new Map();
  }

  drawStart(input = {}) {
    const artist = input.artist === "chen" ? "chen" : "user";
    const canvas = { width: 600, height: 420 };
    let answer;
    let aliases;
    let strokes;
    if (artist === "chen") {
      const preset = PRESETS[Math.floor(this.random() * PRESETS.length) % PRESETS.length];
      answer = preset.answer;
      aliases = preset.aliases;
      strokes = preset.strokes.map(points => ({ tool: "polyline", points, color: "#51475a", width: 7 }));
    } else {
      answer = String(input.answer || "").trim();
      if (!answer || answer.length > 40) throw Object.assign(new Error("请填写 1–40 字的画作答案"), { statusCode: 400, code: "DRAW_ANSWER_INVALID" });
      aliases = Array.isArray(input.aliases) ? input.aliases.map(String).map(value => value.trim()).filter(Boolean).slice(0, 12) : [];
      strokes = normalizeStrokes(input.strokes, canvas);
      if (!strokes.some(stroke => stroke.points.length >= 2)) {
        throw Object.assign(new Error("画板还是空的"), { statusCode: 400, code: "DRAWING_EMPTY" });
      }
    }
    const id = crypto.randomUUID();
    const createdAt = this.now().toISOString();
    this.rounds.set(id, { id, answer, aliases, artist, canvas, strokes, createdAt });
    while (this.rounds.size > this.maxRounds) this.rounds.delete(this.rounds.keys().next().value);
    return { round_id: id, result: "画画提交成功，可以开始猜了。" };
  }

  drawStatus(roundId) {
    const round = this.rounds.get(String(roundId));
    if (!round) throw Object.assign(new Error("画作回合不存在或已过期"), { statusCode: 404, code: "DRAW_ROUND_NOT_FOUND" });
    return {
      canvas: { ...round.canvas },
      artist: round.artist,
      created_at: round.createdAt,
      drawing_svg: strokesToSvg(round.strokes, round.canvas),
      ascii_grid: makeAsciiGrid(round.strokes, round.canvas),
      ascii_grid_note: ASCII_NOTE
    };
  }

  drawGuess(roundId, input = {}) {
    const round = this.rounds.get(String(roundId));
    if (!round) throw Object.assign(new Error("画作回合不存在或已过期"), { statusCode: 404, code: "DRAW_ROUND_NOT_FOUND" });
    const guess = normalizeGuess(input.content);
    if (!guess) throw Object.assign(new Error("请先输入猜测"), { statusCode: 400, code: "DRAW_GUESS_EMPTY" });
    const accepted = [round.answer, ...round.aliases].some(value => normalizeGuess(value) === guess);
    return { result: accepted ? "猜对了" : "没猜中" };
  }
}

module.exports = { DrawGameService, PRESETS, normalizeGuess };
