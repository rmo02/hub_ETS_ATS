/* ─────────────────────────────────────────────────────────────────
   app.js — ETS2 Hub Truck Cluster  (WebSocket + Gauge Rendering)
   ───────────────────────────────────────────────────────────────── */

// Usa o mesmo IP do servidor — funciona no tablet/celular na mesma rede!
const WS_URL = `ws://${window.location.hostname}:3001`;
const RECONNECT_MS = 3000;

let ws = null, reconnectTimer = null;
const $ = id => document.getElementById(id);

// ── Canvas contexts ────────────────────────────────────────────────
const spdCanvas = document.getElementById('speedometer');
const spdCtx = spdCanvas.getContext('2d');
const rpmCanvas = document.getElementById('rpm-gauge');
const rpmCtx = rpmCanvas.getContext('2d');
const fuelCanvas = document.getElementById('fuel-gauge');
const fuelCtx = fuelCanvas.getContext('2d');

// ── Helpers ────────────────────────────────────────────────────────
const mps2kmh = v => (v || 0) * 3.6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v || 0));

function fmtDist(m) { if (!m && m !== 0) return '--'; return (m / 1000) >= 10 ? `${(m / 1000).toFixed(0)} km` : `${(m / 1000).toFixed(1)} km`; }
function fmtTime(s) { if (!s || s <= 0) return '--'; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; }
function fmtGT(min) { if (!min && min !== 0) return '--:--'; const t = Math.floor(min) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }
function fmtGear(g) { if (g == null) return 'N'; if (g === 0) return 'N'; if (g < 0) return 'R'; return String(g); }
function wearColor(v) { return v < 0.3 ? '#22c55e' : v < 0.6 ? '#f59e0b' : '#ef4444'; }
function pct(v) { return `${((v || 0) * 100).toFixed(0)}%`; }
function showEl(id, v) { const e = $(id); if (e) { v ? e.classList.remove('hidden') : e.classList.add('hidden'); } }

// ── Generic analog gauge (arc style) ───────────────────────────────
// startDeg / endDeg: angles in degrees (0=right, clockwise)
function drawArcGauge(ctx, W, H, opts) {
    const {
        value, min, max,
        startDeg = 135, endDeg = 405,  // 270° sweep
        arcColor = '#f59e0b',
        arcColorFn = null,   // fn(ratio) => color
        label, unit,
        ticks = [], subTicks = 0,
        redZoneFrom = null,  // ratio (0-1) where red zone starts
        R = null,
    } = opts;

    const cx = W / 2, cy = H / 2 + (H < 250 ? 8 : 12);
    const radius = R || (W / 2 - 14);
    const START = (startDeg * Math.PI) / 180;
    const END = (endDeg * Math.PI) / 180;
    const ratio = clamp((value - min) / (max - min), 0, 1);

    ctx.clearRect(0, 0, W, H);

    // ── Background glow ring
    const glowGrad = ctx.createRadialGradient(cx, cy, radius - 20, cx, cy, radius + 4);
    glowGrad.addColorStop(0, 'rgba(0,0,0,0)');
    glowGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.beginPath(); ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = glowGrad; ctx.lineWidth = 8; ctx.stroke();

    // ── Track (inactive arc)
    ctx.beginPath(); ctx.arc(cx, cy, radius, START, END);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();

    // ── Red zone
    if (redZoneFrom !== null) {
        const redStart = START + redZoneFrom * (END - START);
        ctx.beginPath(); ctx.arc(cx, cy, radius, redStart, END);
        ctx.strokeStyle = 'rgba(239,68,68,0.2)'; ctx.lineWidth = 14; ctx.stroke();
    }

    // ── Active arc
    if (ratio > 0) {
        const arcEnd = START + ratio * (END - START);
        let color;
        if (arcColorFn) {
            color = arcColorFn(ratio);
        } else {
            color = arcColor;
        }
        // Glow effect
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(cx, cy, radius, START, arcEnd);
        ctx.strokeStyle = color; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
        ctx.restore();
    }

    // ── Tick marks
    const totalTicks = ticks.length > 0 ? (ticks.length - 1) : 10;
    const totalRange = max - min;
    if (ticks.length > 0) {
        ticks.forEach((v) => {
            const r = (v - min) / totalRange;
            const ang = START + r * (END - START);
            const ir = radius - 18;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(ang) * (radius - 5), cy + Math.sin(ang) * (radius - 5));
            ctx.lineTo(cx + Math.cos(ang) * ir, cy + Math.sin(ang) * ir);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.lineCap = 'butt'; ctx.stroke();
            // Label
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.font = `${W < 250 ? 9 : 10}px Inter`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const lr = radius - 28;
            ctx.fillText(v, cx + Math.cos(ang) * lr, cy + Math.sin(ang) * lr);
        });
    }

    // ── Needle dot
    const needleAng = START + ratio * (END - START);
    ctx.beginPath(); ctx.arc(cx + Math.cos(needleAng) * (radius - 7), cy + Math.sin(needleAng) * (radius - 7), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;

    // ── Center dot
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
}

// ── Speed gauge ────────────────────────────────────────────────────
function drawSpeed(kmh, limitKmh) {
    const W = spdCanvas.width, H = spdCanvas.height;
    const overLimit = limitKmh > 5 && kmh > limitKmh;

    drawArcGauge(spdCtx, W, H, {
        value: kmh, min: 0, max: 140,
        startDeg: 135, endDeg: 405,
        arcColorFn: (r) => {
            if (overLimit) return '#ef4444';
            const g = spdCtx.createLinearGradient(20, H / 2, W - 20, H / 2);
            g.addColorStop(0, '#3b82f6');
            g.addColorStop(0.5, '#f59e0b');
            g.addColorStop(1, '#f59e0b');
            return g;
        },
        redZoneFrom: limitKmh > 5 ? limitKmh / 140 : null,
        ticks: [0, 20, 40, 60, 80, 100, 120, 140],
        R: W / 2 - 16,
    });
}

// ── RPM gauge ──────────────────────────────────────────────────────
function drawRpm(rpm, rpmMax) {
    const W = rpmCanvas.width, H = rpmCanvas.height;
    const max = rpmMax || 2500;
    drawArcGauge(rpmCtx, W, H, {
        value: rpm, min: 0, max,
        startDeg: 140, endDeg: 400,
        arcColorFn: (r) => {
            if (r > 0.82) return '#ef4444';
            if (r > 0.65) return '#f59e0b';
            return '#3b82f6';
        },
        redZoneFrom: 0.82,
        ticks: [0, 500, 1000, 1500, 2000, 2500].filter(v => v <= max),
        R: W / 2 - 14,
    });
}

// ── Fuel gauge ─────────────────────────────────────────────────────
function drawFuel(pct) {
    const W = fuelCanvas.width, H = fuelCanvas.height;
    drawArcGauge(fuelCtx, W, H, {
        value: pct, min: 0, max: 1,
        startDeg: 145, endDeg: 395,
        arcColorFn: (r) => {
            if (r < 0.2) return '#ef4444';
            if (r < 0.4) return '#f97316';
            return '#22c55e';
        },
        redZoneFrom: null,
        ticks: [],
        R: W / 2 - 14,
    });
    // E/F labels
    fuelCtx.fillStyle = 'rgba(255,255,255,0.25)'; fuelCtx.font = '10px Inter'; fuelCtx.textAlign = 'center';
    const cx = W / 2, cy = H / 2 + 8, R = W / 2 - 14, START = (145 * Math.PI / 180), END = (395 * Math.PI / 180);
    fuelCtx.fillText('E', cx + Math.cos(START) * (R - 26), cy + Math.sin(START) * (R - 26));
    fuelCtx.fillText('F', cx + Math.cos(END) * (R - 26), cy + Math.sin(END) * (R - 26));
}

// ── Warning light helper ───────────────────────────────────────────
function setWLight(id, on, cls = 'lit') {
    const el = $(id); if (!el) return;
    el.classList.remove('lit', 'lit-solid');
    if (on) el.classList.add(cls);
}

// ── Wear bar ───────────────────────────────────────────────────────
function setWear(barId, valId, v) {
    const el = $(barId); if (!el) return;
    el.style.width = `${((v || 0) * 100).toFixed(0)}%`;
    el.style.background = wearColor(v || 0);
    const ve = $(valId); if (ve) ve.textContent = pct(v || 0);
}

// ── Pedal bar ──────────────────────────────────────────────────────
function setPedal(barId, valId, v) {
    const p = Math.round((v || 0) * 100);
    const e = $(barId); if (e) e.style.width = `${p}%`;
    const ve = $(valId); if (ve) ve.textContent = `${p}%`;
}

// ── Main update ────────────────────────────────────────────────────
function update(d) {

    // ── Badge
    const badge = $('connection-badge'), lbl = $('badge-label');
    badge.classList.remove('badge--connected', 'badge--demo', 'badge--waiting');
    if (d.connected) { badge.classList.add('badge--connected'); lbl.textContent = 'CONECTADO'; }
    else if (d.demo) { badge.classList.add('badge--demo'); lbl.textContent = 'DEMO'; }
    else { badge.classList.add('badge--waiting'); lbl.textContent = 'AGUARDANDO'; }

    // Header
    $('game-time').textContent = fmtGT(d.timeAbs);
    $('truck-name-top').textContent = [d.truckBrand, d.truckName].filter(Boolean).join(' ') || 'ETS2 Hub';
    $('license-plate').textContent = d.truckLicensePlate || '--';

    // Pause
    showEl('footer-paused', d.paused);
    showEl('paused-overlay', d.paused);

    // ── WARNING LIGHTS
    setWLight('wl-engine', d.engineEnabled, 'lit');  // green = engine ON, so invert
    if (d.engineEnabled) { $('wl-engine').classList.remove('lit'); $('wl-engine').classList.add('wlight--blue', 'lit'); }
    else { $('wl-engine').classList.remove('lit'); }
    setWLight('wl-fuel', d.fuelWarning, 'lit');
    setWLight('wl-adblue', d.adblueWarning, 'lit');
    setWLight('wl-air', d.airPressureWarning || d.airPressureEmergency, 'lit');
    setWLight('wl-oil', d.oilPressureWarning, 'lit');
    setWLight('wl-water', d.waterTemperatureWarning, 'lit');
    setWLight('wl-battery', d.batteryVoltageWarning, 'lit');
    setWLight('wl-brake', d.parkBrake, 'lit');
    setWLight('wl-cruise', d.cruiseControl, 'lit');
    setWLight('wl-highbeam', d.lightsBeamHigh, 'lit');
    setWLight('wl-wipers', d.wipers, 'lit');
    setWLight('wl-beacon', d.lightsBeacon, 'lit');
    setWLight('wl-hazard', d.lightsHazard, 'lit');
    // Blinkers
    setWLight('wl-blink-l', d.blinkerLeftActive, 'lit');
    setWLight('wl-blink-r', d.blinkerRightActive, 'lit');
    if (d.blinkerLeftOn && !d.blinkerLeftActive) { $('wl-blink-l').classList.add('lit-solid'); }
    if (d.blinkerRightOn && !d.blinkerRightActive) { $('wl-blink-r').classList.add('lit-solid'); }

    // ── SPEED GAUGE
    const skmh = mps2kmh(d.speed), lkmh = mps2kmh(d.speedLimit);
    drawSpeed(skmh, lkmh);
    $('speed-value').textContent = Math.round(skmh);
    $('speed-value').style.color = (lkmh > 5 && skmh > lkmh) ? '#ef4444' : '#fff';
    if (lkmh > 5) { showEl('speed-limit-badge', true); $('speed-limit-val').textContent = Math.round(lkmh); }
    else { showEl('speed-limit-badge', false); }

    // ── RPM GAUGE
    drawRpm(d.engineRpm || 0, d.engineRpmMax || 2500);
    $('rpm-value').textContent = Math.round(d.engineRpm || 0);

    // ── FUEL GAUGE
    const fp = d.fuelCapacity > 0 ? (d.fuel / d.fuelCapacity) : 0;
    drawFuel(fp);
    const fpEl = $('fuel-pct');
    fpEl.textContent = `${(fp * 100).toFixed(0)}%`;
    fpEl.style.color = fp < 0.15 ? '#ef4444' : fp < 0.3 ? '#f97316' : '#22c55e';

    // ── DIGITAL STRIP
    $('gear-value').textContent = fmtGear(d.gearDashboard ?? d.gear);
    $('engine-status').textContent = d.engineEnabled ? 'ON' : 'OFF';
    $('engine-status').style.color = d.engineEnabled ? '#22c55e' : '#ef4444';
    const ccKmh = mps2kmh(d.cruiseControlSpeed || 0);
    $('cruise-value').textContent = d.cruiseControl && ccKmh > 0 ? `${Math.round(ccKmh)}` : 'OFF';
    $('cruise-value').style.color = d.cruiseControl ? '#22c55e' : '#4a5568';
    $('odometer').textContent = d.truckOdometer ? `${Math.round(d.truckOdometer).toLocaleString('pt-BR')}` : '------';
    const rMin = d.restStop || 0, rH = Math.floor(rMin / 60), rM = Math.floor(rMin % 60);
    $('rest-time').textContent = rH > 0 ? `${rH}h${String(rM).padStart(2, '0')}m` : `${rM}m`;

    // ── ADBLUE STRIP
    const ap = d.adblueCapacity > 0 ? (d.adblue / d.adblueCapacity) : 0;
    const ab = $('adblue-bar');
    ab.style.width = `${(ap * 100).toFixed(1)}%`;
    ab.classList.remove('warn', 'low');
    if (ap < 0.05) ab.classList.add('low'); else if (ap < 0.15) ab.classList.add('warn');
    $('adblue-pct').textContent = `${(ap * 100).toFixed(0)}%`;
    $('adblue-liters').textContent = d.adblue != null ? `${d.adblue.toFixed(1)} L` : '-- L';

    // ── LEFT: ROUTE
    $('city-src').textContent = d.citySrc || '--';
    $('comp-src').textContent = d.compSrc || '--';
    $('city-dst').textContent = d.cityDst || '--';
    $('comp-dst').textContent = d.compDst || '--';
    $('route-dist').textContent = fmtDist(d.routeDistance);
    $('route-time').textContent = fmtTime(d.routeTime);
    $('delivery-window').textContent = d.timeAbsDelivery ? fmtGT(d.timeAbsDelivery) : '--';

    // ── LEFT: PEDALS
    setPedal('p-throttle', 'pv-throttle', d.gameThrottle ?? d.userThrottle);
    setPedal('p-brake', 'pv-brake', d.gameBrake ?? d.userBrake);
    setPedal('p-clutch', 'pv-clutch', d.gameClutch ?? d.userClutch);

    // ── LEFT: TEMPS
    $('water-temp').textContent = d.waterTemperature != null ? `${d.waterTemperature.toFixed(0)}°C` : '--';
    $('oil-temp').textContent = d.oilTemperature != null ? `${d.oilTemperature.toFixed(0)}°C` : '--';
    $('oil-pressure').textContent = d.oilPressure != null ? `${d.oilPressure.toFixed(0)}psi` : '--';
    $('brake-temp').textContent = d.brakeTemperature != null ? `${d.brakeTemperature.toFixed(0)}°C` : '--';
    $('air-pressure').textContent = d.airPressure != null ? `${d.airPressure.toFixed(0)}psi` : '--';
    $('battery-voltage').textContent = d.batteryVoltage != null ? `${d.batteryVoltage.toFixed(1)}V` : '--';

    // ── RIGHT: CARGO
    $('cargo-name').textContent = d.cargo || (d.onJob ? 'Sem nome' : '-- Sem carga --');
    $('cargo-mass').textContent = d.cargoMass ? `${(d.cargoMass / 1000).toFixed(2)} t` : '--';
    $('cargo-planned').textContent = d.plannedDistanceKm ? `${d.plannedDistanceKm} km planejados` : '';
    const dmg = d.cargoDamage || 0;
    $('damage-bar').style.width = `${(dmg * 100).toFixed(1)}%`;
    $('damage-bar').style.background = dmg > 0.3 ? '#ef4444' : dmg > 0.1 ? '#f97316' : '#22c55e';
    $('damage-pct').textContent = `${(dmg * 100).toFixed(1)}%`;

    // ── RIGHT: JOB
    showEl('job-no-job', !d.onJob);
    $('job-income').textContent = d.jobIncome ? `€ ${Number(d.jobIncome).toLocaleString('pt-BR')}` : '€ --';
    $('job-penalty').textContent = d.jobCancelledPenalty ? `- € ${Number(d.jobCancelledPenalty).toLocaleString('pt-BR')}` : '€ --';
    $('job-xp').textContent = d.jobDeliveredEarnedXp ? `${d.jobDeliveredEarnedXp} XP` : '-- XP';
    $('shifter-type').textContent = d.shifterType || '--';

    // ── RIGHT: TRAILER
    const ta = d.trailerAttached;
    showEl('trailer-disconnected', !ta); showEl('trailer-info', ta);
    if (ta) {
        $('trailer-name-big').textContent = d.trailerName || '--';
        $('trailer-brand').textContent = d.trailerBrand || '--';
        $('trailer-plate').textContent = d.trailerLicensePlate || '--';
        setWear('tw-chassis', 'twv-chassis', d.trailerWearChassis);
        setWear('tw-wheels', 'twv-wheels', d.trailerWearWheels);
        setWear('tw-body', 'twv-body', d.trailerWearBody);
        setWear('tw-cargo', 'twv-cargo', d.trailerCargoDamage);
    }

    // ── RIGHT: TRUCK WEAR
    setWear('w-engine', 'wv-engine', d.wearEngine);
    setWear('w-trans', 'wv-trans', d.wearTransmission);
    setWear('w-cabin', 'wv-cabin', d.wearCabin);
    setWear('w-chassis', 'wv-chassis', d.wearChassis);
    setWear('w-wheels', 'wv-wheels', d.wearWheels);
}

// ── WebSocket ──────────────────────────────────────────────────────
function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    const lbl = $('badge-label');
    $('connection-badge').classList.remove('badge--connected', 'badge--demo', 'badge--waiting');
    $('connection-badge').classList.add('badge--waiting');
    lbl.textContent = 'CONECTANDO…';
    ws = new WebSocket(WS_URL);
    ws.onopen = () => console.log('[WS] Conectado');
    ws.onmessage = ev => { try { update(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
    ws.onerror = () => { };
    ws.onclose = () => { lbl.textContent = 'DESCONECTADO'; reconnectTimer = setTimeout(connect, RECONNECT_MS); };
}

// ── Init ───────────────────────────────────────────────────────────
drawSpeed(0, 0);
drawRpm(0, 2500);
drawFuel(0.65);
connect();
