/**
 * Stream-parse Chrome DevTools Performance .json.gz traces (large files).
 * Usage: node scripts/analyze-trace.mjs "chrome dev tools saves/Trace.json.gz"
 */
import { createGunzip } from 'zlib';
import { createReadStream } from 'fs';

async function streamAnalyze(path, label) {
  console.log('\n########', label, path);
  const gz = createReadStream(path).pipe(createGunzip({ chunkSize: 1024 * 1024 }));

  let buf = '';
  let events = 0;
  let minTs = Infinity;
  let maxTs = -Infinity;
  let runTaskOver50 = 0;
  let runTaskOver16 = 0;
  let runTaskMax = 0;
  let layoutN = 0;
  let layoutSum = 0;
  let paintN = 0;
  let paintSum = 0;
  let styleN = 0;
  let styleSum = 0;
  let dropped = 0;
  let drawFrame = 0;
  let updateLayer = 0;
  let raster = 0;
  let imgDecode = 0;
  let mouseMove = 0;
  let clickN = 0;
  const drawTs = [];
  const fnTop = [];
  const urls = new Map();
  let startTime = '';
  let evalScript = 0;
  let evalSum = 0;
  let majorGC = 0;
  let minorGC = 0;
  let commitN = 0;
  let animationFrame = 0;
  let longPaint = 0;
  const nameCounts = new Map();
  const fnAgg = new Map();
  let hitTestN = 0;
  let hitTestSum = 0;
  let parseHTML = 0;
  let parseHTMLSum = 0;
  let layerize = 0;
  let layerizeSum = 0;

  const processEvent = (objStr) => {
    let e;
    try {
      e = JSON.parse(objStr);
    } catch {
      return;
    }
    events++;
    const n = e.name || '';
    nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
    if (e.ts != null) {
      if (e.ts < minTs) minTs = e.ts;
      const end = e.ts + (e.dur || 0);
      if (end > maxTs) maxTs = end;
    }
    if (n === 'RunTask' && e.dur) {
      const ms = e.dur / 1000;
      if (ms > 50) runTaskOver50++;
      if (ms > 16) runTaskOver16++;
      if (ms > runTaskMax) runTaskMax = ms;
    }
    if (n === 'Layout' && e.ph === 'X' && e.dur) {
      layoutN++;
      layoutSum += e.dur / 1000;
    }
    if (n === 'Paint' && e.ph === 'X' && e.dur) {
      paintN++;
      paintSum += e.dur / 1000;
      if (e.dur > 3000) longPaint++;
    }
    if ((n === 'UpdateLayoutTree' || n === 'RecalculateStyles') && e.dur) {
      styleN++;
      styleSum += e.dur / 1000;
    }
    if (n === 'DroppedFrame') dropped++;
    if (n === 'DrawFrame') {
      drawFrame++;
      if (drawTs.length < 25000) drawTs.push(e.ts);
      else if (drawFrame % 4 === 0) drawTs.push(e.ts);
    }
    if (n === 'UpdateLayer') updateLayer++;
    if (n === 'RasterTask') raster++;
    if (n === 'ImageDecodeTask') imgDecode++;
    if (n === 'InputLatency::MouseMove') mouseMove++;
    if (n === 'EventDispatch' && e.args?.data?.type === 'click') clickN++;
    if (n === 'EvaluateScript' && e.dur) {
      evalScript++;
      evalSum += e.dur / 1000;
    }
    if (n === 'MajorGC') majorGC++;
    if (n === 'MinorGC') minorGC++;
    if (n === 'Commit') commitN++;
    if (n === 'AnimationFrame') animationFrame++;
    if (n === 'HitTest' && e.dur) {
      hitTestN++;
      hitTestSum += e.dur / 1000;
    }
    if (n === 'ParseHTML' && e.dur) {
      parseHTML++;
      parseHTMLSum += e.dur / 1000;
    }
    if ((n === 'Layerize' || n === 'UpdateLayerTree') && e.dur) {
      layerize++;
      layerizeSum += e.dur / 1000;
    }
    if (n === 'FunctionCall' && e.dur > 5000) {
      const fn = e.args?.data?.functionName || '?';
      const url = (e.args?.data?.url || '').split('/').pop() || '';
      const key = `${fn} @ ${url}`;
      const cur = fnAgg.get(key) || { max: 0, n: 0, sum: 0 };
      cur.n++;
      cur.sum += e.dur / 1000;
      cur.max = Math.max(cur.max, e.dur / 1000);
      fnAgg.set(key, cur);
      if (fnTop.length < 200) fnTop.push({ ms: e.dur / 1000, fn, url });
    }
    if (n === 'ResourceSendRequest') {
      const u = e.args?.data?.url || '';
      if (
        u.includes('sectorlords') ||
        u.includes('index-') ||
        u.includes('phaser') ||
        u.includes('pages.dev')
      ) {
        urls.set(u, (urls.get(u) || 0) + 1);
      }
    }
  };

  let phase = 'pre'; // pre | inArray | done
  let objDepth = 0;
  let collecting = false;
  let objChars = [];
  let str = false;
  let esc = false;

  for await (const chunk of gz) {
    const s = chunk.toString('utf8');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (phase === 'pre') {
        buf += ch;
        if (buf.length > 400) buf = buf.slice(-400);
        if (buf.includes('"startTime":"') && !startTime) {
          const m = buf.match(/"startTime":"([^"]+)"/);
          if (m) startTime = m[1];
        }
        if (buf.endsWith('"traceEvents":[') || buf.endsWith('"traceEvents": [')) {
          phase = 'inArray';
          buf = '';
        }
        continue;
      }
      if (phase !== 'inArray') continue;

      if (!collecting) {
        if (ch === '{') {
          collecting = true;
          objDepth = 1;
          objChars = ['{'];
          str = false;
          esc = false;
        } else if (ch === ']') {
          phase = 'done';
        }
        continue;
      }

      objChars.push(ch);
      if (str) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') str = false;
        continue;
      }
      if (ch === '"') {
        str = true;
        continue;
      }
      if (ch === '{') objDepth++;
      else if (ch === '}') {
        objDepth--;
        if (objDepth === 0) {
          processEvent(objChars.join(''));
          collecting = false;
          objChars = [];
          if (events % 500000 === 0) {
            process.stderr.write(`  [${label}] events ${events}\n`);
          }
        }
      }
    }
    if (phase === 'done') break;
  }

  console.log('startTime', startTime || '(unknown)');
  console.log('events', events);
  console.log('span_s', ((maxTs - minTs) / 1e6).toFixed(1));
  console.log(
    'RunTask >50ms',
    runTaskOver50,
    'max_ms',
    runTaskMax.toFixed(1),
    '>16ms',
    runTaskOver16,
  );
  console.log('Layout', layoutN, 'sum_ms', layoutSum.toFixed(0));
  console.log('Paint', paintN, 'sum_ms', paintSum.toFixed(0), 'long>3ms', longPaint);
  console.log('Style', styleN, 'sum_ms', styleSum.toFixed(0));
  console.log(
    'Layerize/UpdateLayerTree',
    layerize,
    'sum_ms',
    layerizeSum.toFixed(0),
  );
  console.log(
    'DroppedFrame',
    dropped,
    'UpdateLayer',
    updateLayer,
    'RasterTask',
    raster,
    'ImageDecode',
    imgDecode,
  );
  console.log('DrawFrame', drawFrame, 'Commit', commitN, 'AnimationFrame', animationFrame);
  console.log('MouseMove events', mouseMove, 'click EventDispatch', clickN);
  console.log('HitTest', hitTestN, 'sum_ms', hitTestSum.toFixed(0));
  console.log('ParseHTML', parseHTML, 'sum_ms', parseHTMLSum.toFixed(0));
  console.log('EvaluateScript', evalScript, 'sum_ms', evalSum.toFixed(0));
  console.log('MajorGC', majorGC, 'MinorGC', minorGC);

  drawTs.sort((a, b) => a - b);
  if (drawTs.length > 20) {
    const iv = [];
    for (let i = 1; i < drawTs.length; i++) iv.push((drawTs[i] - drawTs[i - 1]) / 1000);
    iv.sort((a, b) => a - b);
    const med = iv[Math.floor(iv.length / 2)];
    const p95 = iv[Math.floor(iv.length * 0.95)];
    const slow = iv.filter((x) => x > 20).length;
    console.log(
      'frame interval median_ms',
      med.toFixed(2),
      'p95',
      p95.toFixed(2),
      'est_fps',
      (1000 / med).toFixed(1),
      'slow>20ms',
      slow,
      '/',
      iv.length,
    );
  }

  console.log('top FunctionCall aggregates (>5ms each):');
  const ranked = [...fnAgg.entries()]
    .map(([k, v]) => ({ k, ...v }))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, 15);
  for (const o of ranked) {
    console.log(
      `  sum ${o.sum.toFixed(0)}ms  max ${o.max.toFixed(1)}ms  x${o.n}  ${o.k}`,
    );
  }

  console.log('top event names:');
  for (const [n, c] of [...nameCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
    console.log(' ', c, n);
  }

  console.log('notable urls:');
  for (const [u, c] of [...urls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(' ', c, u.slice(0, 140));
  }
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  paths.push(
    'chrome dev tools saves/Trace.json.gz',
    'chrome dev tools saves/Trace2.json.gz',
  );
}
for (const p of paths) {
  await streamAnalyze(p, p.split(/[/\\]/).pop());
}
