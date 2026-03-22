'use strict';

const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const PORT_HTTP = 3000;
const PORT_WS = 3001;
const TICK_MS = 100;

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT_HTTP, () => {
    console.log(`\n  🚛  ETS2 Hub rodando em → http://localhost:${PORT_HTTP}\n`);
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT_WS });
wss.on('connection', (ws) => {
    console.log('  [WS] Cliente conectado');
    ws.on('close', () => console.log('  [WS] Cliente desconectado'));
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of wss.clients) {
        if (client.readyState === 1) client.send(msg);
    }
}

// ─── Demo mode ────────────────────────────────────────────────────────────────
let demoTick = 0;
function getDemoData() {
    demoTick++;
    const t = demoTick * 0.05;
    const speedKmh = Math.max(0, 80 + Math.sin(t * 0.4) * 30 + Math.sin(t * 1.2) * 10);
    const rpm = 900 + (speedKmh / 120) * 1600 + Math.sin(t * 2) * 100;
    const fuel = 0.65 + Math.sin(t * 0.02) * 0.05;
    const fuelL = fuel * 400;
    const throttle = Math.max(0, Math.min(1, 0.4 + Math.sin(t * 0.7) * 0.3));
    const brake = Math.max(0, Math.min(1, Math.max(0, -Math.sin(t * 0.9) * 0.4)));
    const clutch = Math.max(0, Math.min(1, Math.abs(Math.sin(t * 1.5)) * 0.2));
    const adblue = 0.72 + Math.sin(t * 0.015) * 0.03;
    const restMin = Math.max(0, 180 - demoTick * 0.5);

    return {
        demo: true, connected: false, sdkActive: true, paused: false,

        // Truck
        speed: speedKmh / 3.6, speedLimit: 90 / 3.6,
        engineRpm: rpm, engineRpmMax: 2500,
        engineEnabled: true, electricEnabled: true,
        gear: Math.max(1, Math.round(speedKmh / 15)),
        gearDashboard: Math.max(1, Math.round(speedKmh / 15)),
        cruiseControl: speedKmh > 60, cruiseControlSpeed: 90 / 3.6,
        parkBrake: speedKmh < 1, motorBrake: false, differentialLock: false,

        // Pedals
        userThrottle: throttle, userBrake: brake, userClutch: clutch,
        gameThrottle: throttle, gameBrake: brake, gameClutch: clutch,

        // Fuel
        fuel: fuelL, fuelCapacity: 400,
        fuelRange: fuelL * 2.8, fuelAvgConsumption: 0.36, fuelWarning: fuel < 0.15,

        // AdBlue
        adblue: adblue * 40, adblueCapacity: 40, adblueWarning: adblue < 0.1,

        // Air & battery
        airPressure: 120 + Math.sin(t * 0.2) * 5,
        brakeTemperature: 85 + Math.sin(t * 0.3) * 20,
        batteryVoltage: 24.1 + Math.sin(t * 0.1) * 0.3,
        airPressureWarning: false, airPressureEmergency: false,
        oilPressureWarning: false, waterTemperatureWarning: false,
        batteryVoltageWarning: false,

        // Cargo
        cargo: 'Componentes Eletrônicos', cargoMass: 12400,
        cargoDamage: 0.02, isCargoLoaded: true,
        plannedDistanceKm: 520, onJob: true,

        // Route
        citySrc: 'Berlim', compSrc: 'TeckLogistics',
        cityDst: 'Praga', compDst: 'AutoParts GmbH',
        routeDistance: Math.max(0, 320000 - demoTick * 80),
        routeTime: Math.max(0, 13200 - demoTick * 3),

        // Job stats
        jobIncome: 4200, jobCancelledPenalty: 840,
        jobDeliveredEarnedXp: 320,
        jobStartingTime: 480, timeAbsDelivery: 840,
        jobDeliveredDistanceKm: 0, jobDeliveredCargoDamage: 0,

        // Truck model
        truckBrand: 'Scania', truckName: 'R 580',
        truckLicensePlate: 'ETS-2024',
        truckOdometer: 142580 + demoTick * 0.002,
        shifterType: 'automatic',

        // Wear
        wearEngine: 0.04, wearTransmission: 0.02,
        wearCabin: 0.05, wearChassis: 0.03, wearWheels: 0.07,

        // Temps
        oilTemperature: 90 + Math.sin(t * 0.1) * 5,
        waterTemperature: 88 + Math.sin(t * 0.1) * 4,
        oilPressure: 45 + Math.sin(t * 0.3) * 3,

        // Status lights
        wipers: false, blinkerLeftActive: false, blinkerRightActive: false,
        blinkerLeftOn: false, blinkerRightOn: false,
        lightsParking: false, lightsBeamLow: false, lightsBeamHigh: false,
        lightsBeacon: false, lightsBrake: speedKmh < 60 && speedKmh > 1,
        lightsReverse: false, lightsHazard: false,

        // Time
        timeAbs: 480 + demoTick * 0.2, restStop: restMin,

        // Trailer (demo)
        trailerAttached: true,
        trailerBrand: 'Krone',
        trailerName: 'Profiliner',
        trailerLicensePlate: 'KRN-005',
        trailerBodyType: 'curtainsider',
        trailerWearChassis: 0.03,
        trailerWearWheels: 0.05,
        trailerWearBody: 0.02,
        trailerCargoDamage: 0.02,
    };
}

// ─── Telemetry ────────────────────────────────────────────────────────────────
let telemetryLib = null;
let telemetryInstance = null;
let gameConnected = false;

try {
    telemetryLib = require('trucksim-telemetry');
    console.log('  [TEL] Biblioteca trucksim-telemetry carregada com sucesso');
} catch (err) {
    console.warn('  [TEL] Aviso: Não foi possível carregar trucksim-telemetry:', err.message);
    console.warn('  [TEL] Rodando em modo demo.\n');
}

function connectTelemetry() {
    if (!telemetryLib) return;
    try {
        const { truckSimTelemetry } = telemetryLib;
        telemetryInstance = truckSimTelemetry();
        telemetryInstance.on('connected', () => { gameConnected = true; console.log('  [TEL] ✅ Jogo conectado!'); });
        telemetryInstance.on('disconnected', () => { gameConnected = false; console.log('  [TEL] ❌ Jogo desconectado'); });
        console.log('  [TEL] Aguardando conexão com ETS2/ATS...');
    } catch (err) {
        console.warn('  [TEL] Falha ao conectar:', err.message);
        telemetryLib = null; telemetryInstance = null;
    }
}
connectTelemetry();

// ─── Build payload from live data ────────────────────────────────────────────
function num(v) { return typeof v === 'bigint' ? Number(v) : (v ?? 0); }

function buildLivePayload(raw) {
    const trailer = raw.trailers && raw.trailers[0];
    return {
        demo: false, connected: gameConnected,
        sdkActive: raw.sdkActive, paused: raw.paused,

        speed: raw.speed, speedLimit: raw.speedLimit,
        engineRpm: raw.engineRpm, engineRpmMax: raw.engineRpmMax || 2500,
        engineEnabled: raw.engineEnabled, electricEnabled: raw.electricEnabled,
        gear: raw.gear, gearDashboard: raw.gearDashboard,
        cruiseControl: raw.cruiseControl, cruiseControlSpeed: raw.cruiseControlSpeed,
        parkBrake: raw.parkBrake, motorBrake: raw.motorBrake,
        differentialLock: raw.differentialLock,

        // Pedals
        userThrottle: raw.userThrottle, userBrake: raw.userBrake, userClutch: raw.userClutch,
        gameThrottle: raw.gameThrottle, gameBrake: raw.gameBrake, gameClutch: raw.gameClutch,

        fuel: raw.fuel, fuelCapacity: raw.fuelCapacity,
        fuelRange: raw.fuelRange, fuelAvgConsumption: raw.fuelAvgConsumption,
        fuelWarning: raw.fuelWarning,

        adblue: raw.adblue, adblueCapacity: raw.adblueCapacity, adblueWarning: raw.adblueWarning,

        airPressure: raw.airPressure, brakeTemperature: raw.brakeTemperature,
        batteryVoltage: raw.batteryVoltage,
        airPressureWarning: raw.airPressureWarning, airPressureEmergency: raw.airPressureEmergency,
        oilPressureWarning: raw.oilPressureWarning,
        waterTemperatureWarning: raw.waterTemperatureWarning,
        batteryVoltageWarning: raw.batteryVoltageWarning,

        cargo: raw.cargo, cargoId: raw.cargoId, cargoMass: raw.cargoMass,
        cargoDamage: raw.cargoDamage, isCargoLoaded: raw.isCargoLoaded,
        plannedDistanceKm: raw.plannedDistanceKm, onJob: raw.onJob,

        citySrc: raw.citySrc, compSrc: raw.compSrc,
        cityDst: raw.cityDst, compDst: raw.compDst,
        routeDistance: raw.routeDistance, routeTime: raw.routeTime,

        jobIncome: num(raw.jobIncome), jobCancelledPenalty: num(raw.jobCancelledPenalty),
        jobDeliveredEarnedXp: raw.jobDeliveredEarnedXp,
        jobStartingTime: raw.jobStartingTime, timeAbsDelivery: raw.timeAbsDelivery,
        jobDeliveredDistanceKm: raw.jobDeliveredDistanceKm,
        jobDeliveredCargoDamage: raw.jobDeliveredCargoDamage,

        truckBrand: raw.truckBrand, truckName: raw.truckName,
        truckLicensePlate: raw.truckLicensePlate,
        truckOdometer: raw.truckOdometer, shifterType: raw.shifterType,

        wearEngine: raw.wearEngine, wearTransmission: raw.wearTransmission,
        wearCabin: raw.wearCabin, wearChassis: raw.wearChassis, wearWheels: raw.wearWheels,

        wipers: raw.wipers,
        blinkerLeftActive: raw.blinkerLeftActive, blinkerRightActive: raw.blinkerRightActive,
        blinkerLeftOn: raw.blinkerLeftOn, blinkerRightOn: raw.blinkerRightOn,
        lightsParking: raw.lightsParking, lightsBeamLow: raw.lightsBeamLow,
        lightsBeamHigh: raw.lightsBeamHigh, lightsBeacon: raw.lightsBeacon,
        lightsBrake: raw.lightsBrake, lightsReverse: raw.lightsReverse, lightsHazard: raw.lightsHazard,

        oilTemperature: raw.oilTemperature, waterTemperature: raw.waterTemperature,
        oilPressure: raw.oilPressure,

        timeAbs: raw.timeAbs, restStop: raw.restStop,

        // Trailer
        trailerAttached: trailer ? trailer.attached : false,
        trailerBrand: trailer ? trailer.brand : '',
        trailerName: trailer ? trailer.name : '',
        trailerLicensePlate: trailer ? trailer.licensePlate : '',
        trailerBodyType: trailer ? trailer.bodyType : '',
        trailerWearChassis: trailer ? trailer.wearChassis : 0,
        trailerWearWheels: trailer ? trailer.wearWheels : 0,
        trailerWearBody: trailer ? trailer.wearBody : 0,
        trailerCargoDamage: trailer ? trailer.cargoDamage : 0,
    };
}

// ─── Main tick ────────────────────────────────────────────────────────────────
setInterval(() => {
    let payload;
    if (telemetryInstance) {
        try {
            const raw = telemetryInstance.data.current;
            if (raw && raw.sdkActive) {
                gameConnected = true;
                payload = buildLivePayload(raw);
            } else {
                gameConnected = false;
                payload = getDemoData();
            }
        } catch { payload = getDemoData(); }
    } else {
        payload = getDemoData();
    }
    broadcast(payload);
}, TICK_MS);

console.log('  [WS] WebSocket server na porta', PORT_WS);
