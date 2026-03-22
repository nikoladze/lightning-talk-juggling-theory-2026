// startJuggling(canvas, options) → { stop }
//
// options:
//   siteswap  – string or number[]  (default '3')
//   refThrow  – reference throw value for height (default 3)
//   height    – peak height of refThrow in px      (default 267)
//   spacing   – distance between hands in px        (default 300)
//   floorY    – y-coordinate of the throw floor     (default canvas.height - 70)
//   onBeat    – callback(beatPos, throwVal, color) fired when each scoop begins
//               beatPos:  index into the siteswap pattern (0-based)
//               throwVal: the throw value at that beat
//               color:    ball color array ['#fff', midColor, darkColor]
function startJuggling(canvas, {
  siteswap:  rawSiteswap = '3',
  refThrow   = 3,
  height     = 267,
  spacing    = 300,
  floorY     = null,
  onBeat     = null,
} = {}) {
  const ctx = canvas.getContext('2d');

  // ── constants ──────────────────────────────────────────────────────────────
  const G            = 1200;   // px/s²
  const BALL_RADIUS  = 18;     // px
  const SCOOP_DUR    = 0.2;    // s
  const SCOOP_RADIUS = 50;     // Bézier handle length / catch-position offset

  const FLOOR_Y       = floorY ?? (canvas.height - SCOOP_RADIUS - 20);
  const CENTER_X      = canvas.width / 2;
  const LEFT_THROW_X  = CENTER_X - spacing / 2;
  const RIGHT_THROW_X = CENTER_X + spacing / 2;

  // ── siteswap parsing ───────────────────────────────────────────────────────
  function parse(input) {
    if (Array.isArray(input)) return input.map(Number);
    const s = String(input).trim();
    if (/[\s,]/.test(s)) return s.split(/[\s,]+/).filter(Boolean).map(Number);
    return [...s].map(c => {
      if (c >= '0' && c <= '9') return +c;
      const l = c.toLowerCase();
      return l >= 'a' && l <= 'z' ? l.charCodeAt(0) - 87 : 0;
    });
  }

  let ss = parse(rawSiteswap);
  if (!ss.length || ss.some(isNaN)) ss = [3];

  const P        = ss.length;
  const numBalls = Math.round(ss.reduce((a, b) => a + b, 0) / P);
  const T        = (2 * Math.sqrt(2 * height / G) + SCOOP_DUR) / Math.max(1, refThrow);

  function ballColor(i) {
    const hue = (i / numBalls) * 360;
    return ['#fff', `hsl(${hue},100%,60%)`, `hsl(${hue},100%,28%)`];
  }

  // ── initial state ──────────────────────────────────────────────────────────
  // For each future beat [0, maxThrow), find the unique past throw landing there.
  const maxThrow = Math.max(...ss);
  const balls = [];
  for (let landBeat = 0; landBeat < maxThrow; landBeat++) {
    for (let throwVal = 1; throwVal <= maxThrow; throwVal++) {
      const sourceBeat = landBeat - throwVal;
      if (sourceBeat >= 0) continue;
      if (ss[((sourceBeat % P) + P) % P] !== throwVal) continue;

      const sourceOnLeft = ((sourceBeat % 2) + 2) % 2 === 0;
      const xThrow       = sourceOnLeft ? LEFT_THROW_X : RIGHT_THROW_X;
      const isEven       = throwVal % 2 === 0;
      const tFlight      = throwVal * T - SCOOP_DUR;
      const catchDist    = isEven ? 2 * SCOOP_RADIUS
                                  : RIGHT_THROW_X - LEFT_THROW_X + 2 * SCOOP_RADIUS;
      const vxMag        = catchDist / tFlight;
      const vxNext       = isEven ? (sourceOnLeft ? -vxMag :  vxMag)
                                  : (sourceOnLeft ?  vxMag : -vxMag);
      const catchOnLeft  = isEven ? sourceOnLeft : !sourceOnLeft;
      const xCatch       = catchOnLeft ? LEFT_THROW_X  - 2 * SCOOP_RADIUS
                                       : RIGHT_THROW_X + 2 * SCOOP_RADIUS;
      balls.push({
        phase: 'flying',
        x: xCatch, y: FLOOR_Y,
        x0: xThrow, vx: vxNext, vy0: -G * tFlight / 2,
        tLaunch: sourceBeat * T + SCOOP_DUR,
        tLand:   landBeat * T,
        beatIndex: landBeat,
        color: ballColor(balls.length),
        scoop: null,
      });
      break;
    }
  }

  const initialBalls = balls.map(b => ({ ...b }));

  // ── scoop transitions ──────────────────────────────────────────────────────
  function startScoop(ball, tNow) {
    const onLeft = ball.x <= (LEFT_THROW_X + RIGHT_THROW_X) / 2;
    const xThrow = onLeft ? LEFT_THROW_X : RIGHT_THROW_X;

    const vxIn = ball.vx;
    const vyIn = G * (tNow - ball.tLaunch) / 2;  // positive = downward

    // look-ahead: outgoing throw (read-only)
    let bi = ball.beatIndex, safety = 0;
    while (ss[bi % ss.length] === 0 && safety++ < ss.length) bi++;
    const tv    = ss[bi % ss.length];
    if (onBeat) onBeat(bi % P, tv, ball.color);
    const even  = tv % 2 === 0;
    const tf    = Math.max(0.01, tv * T - SCOOP_DUR);
    const cd    = even ? 2 * SCOOP_RADIUS : RIGHT_THROW_X - LEFT_THROW_X + 2 * SCOOP_RADIUS;
    const vm    = cd / tf;
    const vxOut  = even ? (onLeft ? -vm : +vm) : (onLeft ? +vm : -vm);
    const vy0Out = -G * tf / 2;   // negative = upward

    // cubic Bézier: control points along incoming/outgoing tangents → no kinks
    const x0 = ball.x, y0 = FLOOR_Y, x3 = xThrow, y3 = FLOOR_Y;
    const lI = Math.hypot(vxIn,  vyIn)   || 1;
    const lO = Math.hypot(vxOut, vy0Out) || 1;

    ball.scoop = {
      tStart: tNow, tEnd: tNow + SCOOP_DUR, xThrow,
      x0, y0,
      cx1: x0 + (vxIn  / lI) * SCOOP_RADIUS,
      cy1: y0 + (vyIn  / lI) * SCOOP_RADIUS,
      cx2: x3 - (vxOut / lO) * SCOOP_RADIUS,
      cy2: y3 - (vy0Out / lO) * SCOOP_RADIUS,
      x3, y3,
    };
    ball.phase = 'scooping';
  }

  function completeScoop(ball, tNow) {
    const s = ball.scoop;
    let safety = 0;
    while (ss[ball.beatIndex % ss.length] === 0 && safety++ < ss.length)
      ball.beatIndex++;
    const tv   = ss[ball.beatIndex % ss.length];
    const even = tv % 2 === 0;
    const tf   = Math.max(0.01, tv * T - SCOOP_DUR);
    const cd   = even ? 2 * SCOOP_RADIUS : RIGHT_THROW_X - LEFT_THROW_X + 2 * SCOOP_RADIUS;
    const vm   = cd / tf;
    const ol   = s.xThrow === LEFT_THROW_X;
    const b    = ball.beatIndex;
    ball.x0        = s.xThrow;
    ball.vx        = even ? (ol ? -vm : +vm) : (ol ? +vm : -vm);
    ball.vy0       = -G * tf / 2;
    ball.tLaunch   = b * T + SCOOP_DUR;
    ball.tLand     = ball.tLaunch + tf;
    ball.beatIndex += tv;
    ball.scoop     = null;
    ball.phase     = 'flying';
  }

  // ── per-frame update ───────────────────────────────────────────────────────
  function updateBall(ball, t) {
    for (let i = 0; i < 200; i++) {
      if (ball.phase === 'flying' && t >= ball.tLand) {
        ball.x = ball.x0 + ball.vx * (ball.tLand - ball.tLaunch);
        ball.y = FLOOR_Y;
        startScoop(ball, ball.tLand);
      } else if (ball.phase === 'scooping' && t >= ball.scoop.tEnd) {
        completeScoop(ball, ball.scoop.tEnd);
      } else break;
    }
    if (ball.phase === 'flying') {
      const tau = t - ball.tLaunch;
      ball.x = ball.x0 + ball.vx * tau;
      ball.y = FLOOR_Y + ball.vy0 * tau + 0.5 * G * tau * tau;
    } else if (ball.phase === 'scooping') {
      const s = ball.scoop, f = (t - s.tStart) / SCOOP_DUR, g = 1 - f;
      ball.x = g*g*g*s.x0 + 3*g*g*f*s.cx1 + 3*g*f*f*s.cx2 + f*f*f*s.x3;
      ball.y = g*g*g*s.y0 + 3*g*g*f*s.cy1 + 3*g*f*f*s.cy2 + f*f*f*s.y3;
    }
  }

  function drawBall(x, y, [hi, mid, lo]) {
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    const gr = ctx.createRadialGradient(x - 5, y - 6, 2, x, y, BALL_RADIUS);
    gr.addColorStop(0,   hi);
    gr.addColorStop(0.2, mid);
    gr.addColorStop(1,   lo);
    ctx.fillStyle = gr;
    ctx.fill();
  }

  // ── animation loop ─────────────────────────────────────────────────────────
  let animId = null;
  let animStartTime = null;
  let simOffset = 0;
  let simLimit  = null;

  function loop(timestamp) {
    if (animStartTime === null) animStartTime = timestamp;
    const t = simOffset + (timestamp - animStartTime) / 1000;

    if (simLimit !== null && t >= simLimit) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const ball of balls) { updateBall(ball, simLimit); drawBall(ball.x, ball.y, ball.color); }
      simOffset = simLimit;
      animId = null;
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const ball of balls) {
      updateBall(ball, t);
      drawBall(ball.x, ball.y, ball.color);
    }
    animId = requestAnimationFrame(loop);
  }

  function seekTo(targetT) {
    if (animId !== null) { cancelAnimationFrame(animId); animId = null; }
    simLimit = null;
    balls.length = 0;
    initialBalls.forEach(b => balls.push({ ...b }));
    for (const ball of balls) updateBall(ball, targetT);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const ball of balls) drawBall(ball.x, ball.y, ball.color);
    simOffset = targetT;
    animStartTime = null;
  }

  function stepBeats(n) {
    simLimit = simOffset + n * T;
    animStartTime = null;
    if (animId !== null) cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
  }

  animId = requestAnimationFrame(loop);

  return {
    stop()    { if (animId !== null) { cancelAnimationFrame(animId); animId = null; } },
    T,
    seekTo,
    stepBeats,
  };
}
