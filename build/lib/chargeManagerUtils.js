"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEMAND_HEADROOM = exports.RECLAIM_DELAY_CYCLES = exports.DEMAND_DEADBAND = exports.RELEASE_RETRY_INTERVAL = exports.RELEASE_RETRY_LIMIT = exports.CAR_STATE_FINISHED = exports.IDLE_CHARGE_POWER = exports.IDLE_RELEASE_DELAY_MS = exports.PHASE_MODE_AUTO = exports.FORCE_STATE_ON = exports.FORCE_STATE_NEUTRAL = exports.DEFAULT_PHASE_TOGGLE_WAIT_MS = exports.SUPPLY_LIMIT_RELAX_W_PER_MIN = exports.GRID_IMPORT_MIN_MS = exports.GRID_IMPORT_CYCLES = exports.GRID_IMPORT_THRESHOLD_W = exports.CURRENT_DEADBAND = exports.PHASE_SWITCH_HYSTERESIS = exports.PHASE_SWITCH_DOWN_DELAY_MS = exports.PHASE_SWITCH_UP_DELAY_MS = exports.PHASE_SWITCH_DELAY_CYCLES = exports.PHASE_VOLTAGE = exports.DEFAULT_MAXIMUM_BATTERY_BONUS = exports.DEFAULT_RESERVE_POWER = exports.SHUTDOWN_DELAY_CYCLES = exports.START_CHARGE_CURRENT = exports.MAX_CHARGE_CURRENT = exports.MIN_CHARGE_CURRENT = void 0;
exports.resolveWallboxCurrentLimits = resolveWallboxCurrentLimits;
exports.evaluateBatteryAvailability = evaluateBatteryAvailability;
exports.calculateAvailableSurplusPower = calculateAvailableSurplusPower;
exports.isSupplyLimited = isSupplyLimited;
exports.calculateOptimalChargeCurrent = calculateOptimalChargeCurrent;
exports.resolveStartChargeCurrent = resolveStartChargeCurrent;
exports.stepChargeCurrent = stepChargeCurrent;
exports.updateShutdownDelay = updateShutdownDelay;
exports.decideChargeManager = decideChargeManager;
exports.updateSupplyLimit = updateSupplyLimit;
exports.decideChargeManagerFleet = decideChargeManagerFleet;
exports.decidePhaseSwitch = decidePhaseSwitch;
exports.chargerPauseMs = chargerPauseMs;
exports.seedChargeManagerState = seedChargeManagerState;
exports.releaseReadback = releaseReadback;
exports.enforceOffState = enforceOffState;
exports.planningPhases = planningPhases;
exports.mayWritePhaseSwitch = mayWritePhaseSwitch;
exports.phaseSwitchDwellCycles = phaseSwitchDwellCycles;
exports.describeHold = describeHold;
exports.planChargeManagerFleet = planChargeManagerFleet;
exports.phaseModeToSend = phaseModeToSend;
exports.resolvePhaseModeWrite = resolvePhaseModeWrite;
exports.phaseModeOf = phaseModeOf;
exports.decideIdleRelease = decideIdleRelease;
exports.chargePowerFromStatusV1 = chargePowerFromStatusV1;
exports.isVehicleDisconnected = isVehicleDisconnected;
exports.withdrawReleaseWithModesOff = withdrawReleaseWithModesOff;
exports.updateReleaseRejects = updateReleaseRejects;
exports.holdRejectedRelease = holdRejectedRelease;
exports.dropUnchangedChargerCommands = dropUnchangedChargerCommands;
exports.buildChargerCommands = buildChargerCommands;
exports.limitTotalCurrent = limitTotalCurrent;
exports.effectiveCurrentDemand = effectiveCurrentDemand;
exports.MIN_CHARGE_CURRENT = 6;
exports.MAX_CHARGE_CURRENT = 32;
exports.START_CHARGE_CURRENT = 10;
exports.SHUTDOWN_DELAY_CYCLES = 12;
exports.DEFAULT_RESERVE_POWER = 100;
exports.DEFAULT_MAXIMUM_BATTERY_BONUS = 2000;
exports.PHASE_VOLTAGE = 230;
exports.PHASE_SWITCH_DELAY_CYCLES = 12;
exports.PHASE_SWITCH_UP_DELAY_MS = 60 * 1000;
exports.PHASE_SWITCH_DOWN_DELAY_MS = 3 * 60 * 1000;
exports.PHASE_SWITCH_HYSTERESIS = 1.25;
function resolveWallboxCurrentLimits(input) {
    const isUsable = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
    const installationMax = Number.isFinite(input.installationMaxCurrent) && input.installationMaxCurrent > 0 ? Math.floor(input.installationMaxCurrent) : exports.MAX_CHARGE_CURRENT;
    const maxCandidates = [installationMax];
    if (isUsable(input.configuredMaxCurrent)) {
        maxCandidates.push(Math.floor(input.configuredMaxCurrent));
    }
    if (isUsable(input.hardwareMaxCurrent)) {
        maxCandidates.push(Math.floor(input.hardwareMaxCurrent));
    }
    const maxCurrent = Math.min(exports.MAX_CHARGE_CURRENT, Math.max(exports.MIN_CHARGE_CURRENT, Math.min(...maxCandidates)));
    const minCandidates = [exports.MIN_CHARGE_CURRENT];
    if (isUsable(input.configuredMinCurrent)) {
        minCandidates.push(Math.floor(input.configuredMinCurrent));
    }
    if (isUsable(input.hardwareMinCurrent)) {
        minCandidates.push(Math.floor(input.hardwareMinCurrent));
    }
    const minCurrent = Math.min(maxCurrent, Math.max(...minCandidates));
    return { minCurrent, maxCurrent };
}
function evaluateBatteryAvailability(input) {
    if (input.mode === "disabled") {
        return { ready: true, reason: "disabled", batterySoc: null };
    }
    if (typeof input.batterySoc !== "number" ||
        !Number.isFinite(input.batterySoc) ||
        input.batterySoc < 0 ||
        input.batterySoc > 100 ||
        typeof input.minimumBatterySoc !== "number" ||
        !Number.isFinite(input.minimumBatterySoc) ||
        input.minimumBatterySoc < 0 ||
        input.minimumBatterySoc > 100) {
        return { ready: false, reason: "invalid", batterySoc: null };
    }
    if (input.maximumAgeSeconds > 0 &&
        (input.batterySocAgeMs === null ||
            !Number.isFinite(input.batterySocAgeMs) ||
            input.batterySocAgeMs < 0 ||
            input.batterySocAgeMs > input.maximumAgeSeconds * 1000)) {
        return { ready: false, reason: "stale", batterySoc: input.batterySoc };
    }
    const stopThreshold = Math.max(0, input.minimumBatterySoc - input.hysteresis);
    const ready = input.wasReady ? input.batterySoc >= stopThreshold : input.batterySoc >= input.minimumBatterySoc;
    return {
        ready,
        reason: ready ? "available" : "below-minimum",
        batterySoc: input.batterySoc,
    };
}
function calculateAvailableSurplusPower(input) {
    const numericInputs = [input.solarPower, input.houseConsumption, input.chargerPower, input.reservePower, input.maximumBatteryBonus];
    if (!numericInputs.every(value => Number.isFinite(value)) || input.reservePower < 0 || input.maximumBatteryBonus < 0) {
        return null;
    }
    if (input.batteryMode !== "disabled" &&
        (input.batterySoc === null ||
            !Number.isFinite(input.batterySoc) ||
            input.batterySoc < 0 ||
            input.batterySoc > 100 ||
            !Number.isFinite(input.minBatterySoc) ||
            input.minBatterySoc < 0 ||
            input.minBatterySoc > 100)) {
        return null;
    }
    const batteryOffset = input.batteryMode === "priority" && input.batterySoc !== null && input.minBatterySoc < 100
        ? Math.max(0, (input.maximumBatteryBonus / (100 - input.minBatterySoc)) * (input.batterySoc - input.minBatterySoc))
        : 0;
    const surplus = input.solarPower - input.houseConsumption + (input.subtractChargerPower ? input.chargerPower : 0) - input.reservePower + batteryOffset;
    if (typeof input.supplyLimit !== "number" || !Number.isFinite(input.supplyLimit)) {
        return surplus;
    }
    const otherLoad = input.subtractChargerPower ? input.houseConsumption - input.chargerPower : input.houseConsumption;
    return Math.min(surplus, input.supplyLimit - otherLoad - input.reservePower);
}
function isSupplyLimited(input) {
    const limited = calculateAvailableSurplusPower(input);
    const unlimited = calculateAvailableSurplusPower({ ...input, supplyLimit: null });
    return limited !== null && unlimited !== null && limited < unlimited;
}
function calculateOptimalChargeCurrent(input) {
    if (!Number.isFinite(input.phases) ||
        !Number.isFinite(input.maximumChargeCurrent) ||
        (input.phases !== 1 && input.phases !== 3) ||
        !Number.isInteger(input.maximumChargeCurrent) ||
        input.maximumChargeCurrent < exports.MIN_CHARGE_CURRENT ||
        input.maximumChargeCurrent > exports.MAX_CHARGE_CURRENT) {
        return null;
    }
    const availablePower = calculateAvailableSurplusPower(input);
    if (availablePower === null) {
        return null;
    }
    const calculatedCurrent = Math.floor(availablePower / exports.PHASE_VOLTAGE / input.phases);
    return Math.max(0, Math.min(calculatedCurrent, input.maximumChargeCurrent));
}
function resolveStartChargeCurrent(minimum, maximum) {
    return Math.min(Math.max(exports.START_CHARGE_CURRENT, minimum), maximum);
}
exports.CURRENT_DEADBAND = 2;
function stepChargeCurrent(current, target, maximum = exports.MAX_CHARGE_CURRENT, minimum = exports.MIN_CHARGE_CURRENT, followDown = false) {
    const safeMaximum = Number.isInteger(maximum) && maximum >= exports.MIN_CHARGE_CURRENT && maximum <= exports.MAX_CHARGE_CURRENT ? maximum : exports.MAX_CHARGE_CURRENT;
    const safeMinimum = Number.isInteger(minimum) && minimum >= exports.MIN_CHARGE_CURRENT && minimum <= safeMaximum ? minimum : exports.MIN_CHARGE_CURRENT;
    const safeCurrent = Number.isFinite(current) ? Math.max(0, Math.min(Math.trunc(current), safeMaximum)) : 0;
    const safeTarget = Number.isFinite(target) ? Math.max(0, Math.min(Math.trunc(target), safeMaximum)) : 0;
    const gap = safeTarget - safeCurrent;
    if (gap === 0) {
        return safeCurrent;
    }
    const start = resolveStartChargeCurrent(safeMinimum, safeMaximum);
    const reachesStart = safeCurrent < start && safeTarget >= start;
    const atRangeEnd = safeTarget <= safeMinimum || safeTarget === safeMaximum || reachesStart;
    if (atRangeEnd || Math.abs(gap) >= exports.CURRENT_DEADBAND || (followDown && gap < 0)) {
        return safeCurrent + Math.sign(gap);
    }
    return safeCurrent;
}
function updateShutdownDelay(current, minimum, previousDelay) {
    if (!Number.isFinite(current) || !Number.isFinite(minimum) || current >= minimum) {
        return 0;
    }
    const safePreviousDelay = Number.isFinite(previousDelay) ? Math.max(0, Math.trunc(previousDelay)) : 0;
    return safePreviousDelay + 1;
}
function decideChargeManager(input) {
    const optimalCurrent = calculateOptimalChargeCurrent(input);
    if (optimalCurrent === null ||
        !Number.isInteger(input.minimumChargeCurrent) ||
        input.minimumChargeCurrent < exports.MIN_CHARGE_CURRENT ||
        input.minimumChargeCurrent > input.maximumChargeCurrent) {
        return {
            action: "disable",
            reason: "invalid-input",
            optimalCurrent: null,
            nextState: { currentAmp: 0, shutdownDelay: 0 },
        };
    }
    const supplyLimited = isSupplyLimited(input);
    const tagged = (decision) => (supplyLimited ? { ...decision, supplyLimited: true } : decision);
    const currentAmp = stepChargeCurrent(input.state.currentAmp, optimalCurrent, input.maximumChargeCurrent, input.minimumChargeCurrent, supplyLimited);
    const startChargeCurrent = resolveStartChargeCurrent(input.minimumChargeCurrent, input.maximumChargeCurrent);
    const isRampingToRaisedMinimum = input.minimumChargeCurrent > exports.START_CHARGE_CURRENT && optimalCurrent >= input.minimumChargeCurrent && currentAmp < input.minimumChargeCurrent;
    let shutdownDelay = isRampingToRaisedMinimum ? 0 : updateShutdownDelay(currentAmp, input.minimumChargeCurrent, input.state.shutdownDelay);
    if (currentAmp >= (input.released === true ? input.minimumChargeCurrent : startChargeCurrent)) {
        return tagged({
            action: "enable",
            reason: "charging-current",
            optimalCurrent,
            nextState: { currentAmp, shutdownDelay },
        });
    }
    if (currentAmp < input.minimumChargeCurrent) {
        if (shutdownDelay > exports.SHUTDOWN_DELAY_CYCLES) {
            shutdownDelay = 0;
            return tagged({
                action: "disable",
                reason: "insufficient-surplus",
                optimalCurrent,
                nextState: { currentAmp, shutdownDelay },
            });
        }
        return tagged({
            action: "hold",
            reason: "shutdown-delay",
            optimalCurrent,
            nextState: { currentAmp, shutdownDelay },
        });
    }
    return tagged({
        action: "hold",
        reason: "hysteresis",
        optimalCurrent,
        nextState: { currentAmp, shutdownDelay },
    });
}
exports.GRID_IMPORT_THRESHOLD_W = 150;
exports.GRID_IMPORT_CYCLES = 2;
exports.GRID_IMPORT_MIN_MS = 120000;
exports.SUPPLY_LIMIT_RELAX_W_PER_MIN = 250;
function updateSupplyLimit(previous, input) {
    const gridImport = typeof input.gridImport === "number" && Number.isFinite(input.gridImport) ? input.gridImport : null;
    const measured = Number.isFinite(input.houseConsumption) && Number.isFinite(input.chargerPower);
    const totalDraw = input.subtractChargerPower ? input.houseConsumption : input.houseConsumption + input.chargerPower;
    const importing = measured && gridImport !== null && gridImport > exports.GRID_IMPORT_THRESHOLD_W && input.chargerPower > 0;
    const previousCycles = Number.isFinite(previous.importCycles) ? Math.max(0, Math.trunc(previous.importCycles)) : 0;
    const importCycles = importing ? previousCycles + 1 : 0;
    const cycleTimeMs = Number.isFinite(input.cycleTimeMs) && input.cycleTimeMs > 0 ? input.cycleTimeMs : 0;
    const neededCycles = previous.limit === null && cycleTimeMs > 0 ? Math.max(exports.GRID_IMPORT_CYCLES, Math.ceil(exports.GRID_IMPORT_MIN_MS / cycleTimeMs)) : exports.GRID_IMPORT_CYCLES;
    if (importing && importCycles >= neededCycles) {
        return { state: { limit: totalDraw - gridImport, importCycles: 0 }, event: previous.limit === null ? "created" : null };
    }
    if (previous.limit === null || importCycles > 0) {
        return { state: { limit: previous.limit, importCycles }, event: null };
    }
    const limit = previous.limit + (exports.SUPPLY_LIMIT_RELAX_W_PER_MIN * cycleTimeMs) / 60000;
    const otherLoad = totalDraw - input.chargerPower;
    if (measured && Number.isFinite(input.maximumFleetPower) && limit - otherLoad - input.reservePower >= input.maximumFleetPower) {
        return { state: { limit: null, importCycles: 0 }, event: "released" };
    }
    return { state: { limit, importCycles: 0 }, event: null };
}
function decideChargeManagerFleet(shared, participants) {
    let claimedPower = 0;
    return participants.map(participant => {
        const surplus = {
            ...shared,
            solarPower: shared.solarPower - claimedPower,
            ...(typeof shared.supplyLimit === "number" ? { supplyLimit: shared.supplyLimit - claimedPower } : {}),
        };
        const decision = decideChargeManager({
            ...surplus,
            maximumChargeCurrent: participant.maximumChargeCurrent,
            minimumChargeCurrent: participant.minimumChargeCurrent,
            phases: participant.phases,
            state: participant.state,
            released: participant.released,
        });
        const availablePower = calculateAvailableSurplusPower(surplus) ?? 0;
        if (participant.claimsPower) {
            const reservedCurrent = Math.max(decision.optimalCurrent ?? 0, decision.nextState.currentAmp);
            claimedPower += reservedCurrent * exports.PHASE_VOLTAGE * participant.phases;
        }
        return { ...decision, availablePower };
    });
}
function decidePhaseSwitch(input) {
    if (input.blocked === true ||
        (input.currentPhases !== 1 && input.currentPhases !== 3) ||
        !Number.isFinite(input.availablePower) ||
        !Number.isFinite(input.minimumChargeCurrent) ||
        !Number.isFinite(input.maximumChargeCurrent)) {
        return { targetPhases: input.currentPhases, switchDelay: 0 };
    }
    const floorCurrent = input.waitingForStart ? resolveStartChargeCurrent(input.minimumChargeCurrent, input.maximumChargeCurrent) : input.minimumChargeCurrent;
    const threePhaseMinPower = floorCurrent * 3 * exports.PHASE_VOLTAGE;
    const upThreshold = Math.max(input.maximumChargeCurrent * exports.PHASE_VOLTAGE, input.waitingForStart ? threePhaseMinPower : threePhaseMinPower * exports.PHASE_SWITCH_HYSTERESIS);
    let targetPhases = input.currentPhases;
    if (input.currentPhases === 1 && input.availablePower >= upThreshold) {
        targetPhases = 3;
    }
    else if (input.currentPhases === 3 && input.availablePower < threePhaseMinPower && input.availablePower >= floorCurrent * exports.PHASE_VOLTAGE) {
        targetPhases = 1;
    }
    if (targetPhases === input.currentPhases) {
        return { targetPhases: input.currentPhases, switchDelay: 0 };
    }
    const delayCycles = validDelayCycles(targetPhases === 3 ? input.upDelayCycles : input.downDelayCycles);
    const switchDelay = input.switchDelay + 1;
    if (switchDelay > delayCycles) {
        return { targetPhases, switchDelay: 0 };
    }
    return { targetPhases: input.currentPhases, switchDelay };
}
function validDelayCycles(cycles) {
    return cycles !== undefined && Number.isFinite(cycles) && cycles >= 0 ? Math.trunc(cycles) : exports.PHASE_SWITCH_DELAY_CYCLES;
}
exports.DEFAULT_PHASE_TOGGLE_WAIT_MS = 10 * 60 * 1000;
function chargerPauseMs(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function seedChargeManagerState(reportedAllow, reportedAmp, minimum, maximum) {
    if (reportedAllow !== 1 || !Number.isFinite(reportedAmp) || reportedAmp <= 0) {
        return { currentAmp: 0, shutdownDelay: 0 };
    }
    return { currentAmp: Math.min(Math.max(Math.trunc(reportedAmp), minimum), maximum), shutdownDelay: 0 };
}
exports.FORCE_STATE_NEUTRAL = 0;
exports.FORCE_STATE_ON = 2;
function releaseReadback(reportedAllow, forceState) {
    return forceState === exports.FORCE_STATE_NEUTRAL ? undefined : reportedAllow;
}
function enforceOffState(forceState, releasedByAdapter) {
    return releasedByAdapter !== true && forceState === exports.FORCE_STATE_NEUTRAL;
}
function planningPhases(pendingPhases, enabledPhases) {
    return pendingPhases === 1 || pendingPhases === 3 ? pendingPhases : enabledPhases;
}
function mayWritePhaseSwitch(forceState, action) {
    return forceState === exports.FORCE_STATE_ON && action !== "disable";
}
function phaseSwitchDwellCycles(delayMs, cycleTimeMs, forceState) {
    return forceState === exports.FORCE_STATE_ON ? Math.ceil(delayMs / cycleTimeMs) : 0;
}
function describeHold(optimalCurrent, minimumCurrent, released) {
    if (!Number.isFinite(optimalCurrent) || !Number.isFinite(minimumCurrent) || optimalCurrent < minimumCurrent) {
        return "not-enough";
    }
    return released ? "charging" : "ramping";
}
function planChargeManagerFleet(shared, participants, phaseInputs) {
    const decisions = decideChargeManagerFleet(shared, participants);
    const phases = phaseInputs.map((phaseInput, index) => phaseInput
        ? decidePhaseSwitch({
            currentPhases: phaseInput.currentPhases,
            availablePower: decisions[index].availablePower,
            minimumChargeCurrent: participants[index].minimumChargeCurrent,
            maximumChargeCurrent: participants[index].maximumChargeCurrent,
            switchDelay: phaseInput.switchDelay,
            upDelayCycles: phaseInput.upDelayCycles,
            downDelayCycles: decisions[index].reason === "insufficient-surplus" ? 0 : phaseInput.downDelayCycles,
            blocked: phaseInput.blocked,
            waitingForStart: phaseInput.waitingForStart,
        })
        : null);
    const switched = phases.some((phase, index) => phase && phase.targetPhases !== phaseInputs[index]?.currentPhases);
    if (!switched) {
        return { decisions, phases };
    }
    const switchedParticipants = participants.map((participant, index) => {
        const targetPhases = phases[index]?.targetPhases || participant.phases;
        if (targetPhases === participant.phases) {
            return participant;
        }
        const { currentAmp } = participant.state;
        const samePower = Math.max(participant.minimumChargeCurrent, Math.floor((currentAmp * participant.phases) / targetPhases));
        return { ...participant, phases: targetPhases, state: { ...participant.state, currentAmp: Math.min(currentAmp, samePower) } };
    });
    return { decisions: decideChargeManagerFleet(shared, switchedParticipants), phases };
}
function phaseModeToSend(charge3Phase, enabledPhases) {
    if (enabledPhases === (charge3Phase ? 3 : 1)) {
        return null;
    }
    return charge3Phase ? 2 : 1;
}
exports.PHASE_MODE_AUTO = 0;
function resolvePhaseModeWrite(value, autoAllowed) {
    if (value === 1 || value === 3) {
        return { auto: false, charge3Phase: value === 3 };
    }
    if (value === exports.PHASE_MODE_AUTO && autoAllowed) {
        return { auto: true };
    }
    return null;
}
function phaseModeOf(auto, charge3Phase) {
    return auto ? exports.PHASE_MODE_AUTO : charge3Phase ? 3 : 1;
}
exports.IDLE_RELEASE_DELAY_MS = 5 * 60 * 1000;
exports.IDLE_CHARGE_POWER = 100;
function decideIdleRelease(input) {
    if (input.carState === 1 || input.controllerAction === "disable") {
        return { withdraw: false, nextState: { idleDelay: 0, latched: false } };
    }
    if (input.state.latched) {
        return { withdraw: false, nextState: { idleDelay: 0, latched: true } };
    }
    const idle = input.releaseActive &&
        (input.carState === 2 || input.carState === 3 || input.carState === 4) &&
        Number.isFinite(input.chargePower) &&
        input.chargePower < exports.IDLE_CHARGE_POWER;
    if (!idle) {
        return { withdraw: false, nextState: { idleDelay: 0, latched: false } };
    }
    const idleDelay = (Number.isFinite(input.state.idleDelay) ? Math.max(0, Math.trunc(input.state.idleDelay)) : 0) + 1;
    if (idleDelay >= Math.max(1, input.delayCycles)) {
        return { withdraw: true, nextState: { idleDelay: 0, latched: true } };
    }
    return { withdraw: false, nextState: { idleDelay, latched: false } };
}
function chargePowerFromStatusV1(nrg) {
    if (!Array.isArray(nrg) || nrg.length < 12) {
        return Number.NaN;
    }
    const raw = nrg[11];
    if (typeof raw !== "number" && (typeof raw !== "string" || raw.trim() === "")) {
        return Number.NaN;
    }
    const power = Number(raw) * 10;
    return Number.isFinite(power) ? power : Number.NaN;
}
function isVehicleDisconnected(carState) {
    return carState === 1;
}
function withdrawReleaseWithModesOff(chargingAllowed, releasedByAdapter) {
    return releasedByAdapter === true && chargingAllowed === true;
}
exports.CAR_STATE_FINISHED = 4;
exports.RELEASE_RETRY_LIMIT = 30;
exports.RELEASE_RETRY_INTERVAL = 6;
function updateReleaseRejects(reportedAllow, requestedAllow, previous) {
    if (requestedAllow === null || !Number.isFinite(reportedAllow) || reportedAllow === requestedAllow) {
        return 0;
    }
    return (Number.isFinite(previous) ? Math.max(0, Math.trunc(previous)) : 0) + 1;
}
function holdRejectedRelease(rejects, carState) {
    if (carState !== exports.CAR_STATE_FINISHED || !Number.isFinite(rejects) || rejects < exports.RELEASE_RETRY_LIMIT) {
        return false;
    }
    return (Math.trunc(rejects) - exports.RELEASE_RETRY_LIMIT) % exports.RELEASE_RETRY_INTERVAL !== 0;
}
const COMMAND_READBACK = { alw: "alw", amp: "amp", amx: "amp" };
function dropUnchangedChargerCommands(commands, reported) {
    return commands.filter(command => reported[COMMAND_READBACK[command.parameter]] !== command.value);
}
function buildChargerCommands(allow, ampere, firmware) {
    if (!allow) {
        return [{ parameter: "alw", value: 0 }];
    }
    if (!Number.isInteger(ampere) || ampere < exports.MIN_CHARGE_CURRENT || ampere > exports.MAX_CHARGE_CURRENT) {
        return null;
    }
    return [
        { parameter: firmware === "033" ? "amp" : "amx", value: ampere },
        { parameter: "alw", value: 1 },
    ];
}
function limitTotalCurrent(participants, maxAmpTotal) {
    if (!Number.isFinite(maxAmpTotal) || maxAmpTotal <= 0) {
        return participants.map(p => ({ allow: p.requestedAmp > 0, ampere: p.requestedAmp > 0 ? p.requestedAmp : 0 }));
    }
    const budget = Math.floor(maxAmpTotal);
    const allocations = participants.map(() => ({ allow: false, ampere: 0 }));
    const order = participants.map((_, index) => index).sort((a, b) => Number(participants[b].chargeNow) - Number(participants[a].chargeNow));
    let used = 0;
    for (const index of order) {
        const participant = participants[index];
        if (participant.requestedAmp <= 0) {
            continue;
        }
        const min = Math.max(exports.MIN_CHARGE_CURRENT, Math.floor(participant.minAmp));
        const want = Math.min(Math.floor(participant.requestedAmp), budget);
        const remaining = budget - used;
        if (want <= remaining) {
            allocations[index] = { allow: true, ampere: want };
            used += want;
        }
        else if (remaining >= min) {
            allocations[index] = { allow: true, ampere: remaining };
            used += remaining;
        }
    }
    return allocations;
}
exports.DEMAND_DEADBAND = 1;
exports.RECLAIM_DELAY_CYCLES = 3;
exports.DEMAND_HEADROOM = 1;
function effectiveCurrentDemand(input) {
    const { commandedAmp, measuredAmp, wishAmp, minAmp, maxAmp, reclaimDelay } = input;
    if (![commandedAmp, measuredAmp, wishAmp, minAmp, maxAmp, reclaimDelay].every(Number.isFinite)) {
        return { demand: Number.isFinite(wishAmp) ? Math.max(0, Math.floor(wishAmp)) : 0, reclaimDelay: 0 };
    }
    const wish = Math.max(0, Math.min(Math.floor(wishAmp), Math.floor(maxAmp)));
    const measured = Math.floor(measuredAmp);
    const commanded = Math.floor(commandedAmp);
    const floor = Math.max(exports.MIN_CHARGE_CURRENT, Math.floor(minAmp));
    if (measured < exports.MIN_CHARGE_CURRENT) {
        return { demand: wish, reclaimDelay: 0 };
    }
    if (measured >= commanded) {
        return { demand: Math.min(wish, commanded + exports.DEMAND_HEADROOM), reclaimDelay: 0 };
    }
    if (measured >= commanded - exports.DEMAND_DEADBAND) {
        return { demand: Math.min(wish, commanded), reclaimDelay: 0 };
    }
    const nextDelay = reclaimDelay + 1;
    if (nextDelay <= exports.RECLAIM_DELAY_CYCLES) {
        return { demand: Math.min(wish, commanded), reclaimDelay: nextDelay };
    }
    return { demand: Math.min(wish, Math.max(floor, measured + exports.DEMAND_HEADROOM)), reclaimDelay: nextDelay };
}
//# sourceMappingURL=chargeManagerUtils.js.map