export const MIN_CHARGE_CURRENT = 6;
export const MAX_CHARGE_CURRENT = 32;
export const START_CHARGE_CURRENT = 10;
export const SHUTDOWN_DELAY_CYCLES = 12;
export const DEFAULT_RESERVE_POWER = 100;
export const DEFAULT_MAXIMUM_BATTERY_BONUS = 2000;
/** Nominal voltage per phase used to convert between charging current and power */
export const PHASE_VOLTAGE = 230;
/** Number of consecutive cycles a phase-switch condition must hold before the phase is actually switched */
export const PHASE_SWITCH_DELAY_CYCLES = 12;
/** How long more surplus must hold before switching up to three phases */
export const PHASE_SWITCH_UP_DELAY_MS = 60 * 1000;
/** How long a lower surplus must hold before switching down to one phase */
export const PHASE_SWITCH_DOWN_DELAY_MS = 3 * 60 * 1000;
/**
 * How far above the three-phase minimum the surplus must reach before switching up, as a factor
 * of that minimum. This is the width of the phase hysteresis band and the tuning knob for it:
 * raise it if the installation still switches back and forth on partly cloudy days.
 */
export const PHASE_SWITCH_HYSTERESIS = 1.25;

/** Per-wallbox configuration and optional hardware caps used to resolve its current limits. */
export interface WallboxLimitInput {
	/** Installation-wide maximum current (maxChargeCurrent); caps every wallbox */
	installationMaxCurrent: number;
	/** User-configured maximum current for this wallbox; 0 (or invalid) means no per-box limit */
	configuredMaxCurrent: number;
	/** User-configured minimum current for this wallbox; 0 (or invalid) means the technical floor */
	configuredMinCurrent: number;
	/** Maximum current the charger hardware accepts, or null when unknown */
	hardwareMaxCurrent: number | null;
	/** Minimum current the charger hardware accepts, or null when unknown */
	hardwareMinCurrent: number | null;
}

/** Effective per-wallbox current limits, both integers within [MIN_CHARGE_CURRENT, MAX_CHARGE_CURRENT]. */
export interface WallboxCurrentLimits {
	/** Lowest current that may be assigned to this wallbox */
	minCurrent: number;
	/** Highest current that may be assigned to this wallbox */
	maxCurrent: number;
}

/**
 * Resolves the effective minimum and maximum charging current for a single wallbox.
 *
 * The maximum is the tightest of the installation limit, the user-configured per-box
 * maximum and the hardware capability; the minimum is the highest of the technical floor,
 * the user-configured per-box minimum and the hardware minimum. A value of 0 (or any
 * non-positive / non-finite value) for a configured or hardware bound means "not set" and
 * is ignored. The minimum can never exceed the resolved maximum, and both results are
 * clamped to the globally supported [MIN_CHARGE_CURRENT, MAX_CHARGE_CURRENT] range.
 *
 * @param input Installation limit, user configuration and optional hardware caps
 * @returns The effective per-wallbox current limits
 */
export function resolveWallboxCurrentLimits(input: WallboxLimitInput): WallboxCurrentLimits {
	const isUsable = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

	const installationMax =
		Number.isFinite(input.installationMaxCurrent) && input.installationMaxCurrent > 0 ? Math.floor(input.installationMaxCurrent) : MAX_CHARGE_CURRENT;

	const maxCandidates = [installationMax];
	if (isUsable(input.configuredMaxCurrent)) {
		maxCandidates.push(Math.floor(input.configuredMaxCurrent));
	}
	if (isUsable(input.hardwareMaxCurrent)) {
		maxCandidates.push(Math.floor(input.hardwareMaxCurrent));
	}
	const maxCurrent = Math.min(MAX_CHARGE_CURRENT, Math.max(MIN_CHARGE_CURRENT, Math.min(...maxCandidates)));

	const minCandidates = [MIN_CHARGE_CURRENT];
	if (isUsable(input.configuredMinCurrent)) {
		minCandidates.push(Math.floor(input.configuredMinCurrent));
	}
	if (isUsable(input.hardwareMinCurrent)) {
		minCandidates.push(Math.floor(input.hardwareMinCurrent));
	}
	// the minimum can never exceed the resolved maximum
	const minCurrent = Math.min(maxCurrent, Math.max(...minCandidates));

	return { minCurrent, maxCurrent };
}

/** Supported ways of incorporating a home battery into surplus charging. */
export type BatteryMode = "disabled" | "minimumSoc" | "priority";

/** Input used to decide whether the configured battery permits EV charging. */
export interface BatteryAvailabilityInput {
	/** Configured home-battery mode */
	mode: BatteryMode;
	/** Untrusted SOC state value */
	batterySoc: unknown;
	/** Untrusted minimum SOC state value */
	minimumBatterySoc: unknown;
	/** Age of the SOC state in milliseconds */
	batterySocAgeMs: number | null;
	/** Maximum accepted SOC age in seconds; zero disables the age check */
	maximumAgeSeconds: number;
	/** Configured SOC stop hysteresis */
	hysteresis: number;
	/** Whether the battery permitted charging in the previous cycle */
	wasReady: boolean;
}

/** Stable explanation for a battery availability decision. */
export type BatteryAvailabilityReason = "available" | "below-minimum" | "disabled" | "invalid" | "stale";

/** Validated battery state used by the ChargeManager. */
export interface BatteryAvailabilityDecision {
	/** Whether surplus charging may continue */
	ready: boolean;
	/** Explanation for the battery decision */
	reason: BatteryAvailabilityReason;
	/** Validated SOC, or null when unavailable or disabled */
	batterySoc: number | null;
}

/** Inputs used by the current surplus calculation. */
export interface ChargeCalculationInput {
	/** Current PV generation in watts */
	solarPower: number;
	/** Current household consumption in watts */
	houseConsumption: number;
	/** Current charger consumption in watts */
	chargerPower: number;
	/** Whether charger consumption is already part of household consumption */
	subtractChargerPower: boolean;
	/** Current home battery state of charge, or null when battery handling is disabled */
	batterySoc: number | null;
	/** Minimum home battery state of charge */
	minBatterySoc: number;
	/** Home-battery handling strategy */
	batteryMode: BatteryMode;
	/** Power kept as a grid reserve in watts */
	reservePower: number;
	/** Maximum power released by the priority battery curve in watts */
	maximumBatteryBonus: number;
	/**
	 * Learned supply limit in watts (see {@link updateSupplyLimit}); caps the surplus at the limit
	 * minus the rest of the house load and the reserve. `null`, absent or not finite: no limit
	 */
	supplyLimit?: number | null;
	/** Highest current the ChargeManager may assign */
	maximumChargeCurrent: number;
	/** Number of active charging phases */
	phases: number;
}

/** Internal state carried between ChargeManager control cycles. */
export interface ChargeManagerState {
	/** Current ramped charging-current target */
	currentAmp: number;
	/** Number of consecutive cycles below the minimum charging current */
	shutdownDelay: number;
}

/** Inputs required for one deterministic ChargeManager control decision. */
export interface ChargeManagerControllerInput extends ChargeCalculationInput {
	/** Current below which the shutdown delay advances */
	minimumChargeCurrent: number;
	/** Internal state from the previous control cycle */
	state: ChargeManagerState;
	/** The charger reports the charge release (`frc` 2), so the charge is running or about to */
	released?: boolean;
}

/** Transport action requested by the ChargeManager controller. */
export type ChargeManagerAction = "enable" | "disable" | "hold";

/** Stable explanation for a ChargeManager control decision. */
export type ChargeManagerReason = "charging-current" | "hysteresis" | "insufficient-surplus" | "invalid-input" | "shutdown-delay";

/** Result of one deterministic ChargeManager control cycle. */
export interface ChargeManagerDecision {
	/** Charger transport action; `hold` sends no command */
	action: ChargeManagerAction;
	/** Explanation for the selected action */
	reason: ChargeManagerReason;
	/** Newly calculated current before applying the one-ampere ramp */
	optimalCurrent: number | null;
	/** Internal state to retain for the next control cycle */
	nextState: ChargeManagerState;
	/** Only present (`true`) when the learned supply limit, not the surplus, set the target */
	supplyLimited?: boolean;
}

/** One validated go-e API command. */
export interface ChargerCommand {
	/** go-e API parameter */
	parameter: "alw" | "amp" | "amx";
	/** Numeric go-e API parameter value */
	value: number;
}

/**
 * Validates battery data and applies the configured minimum-SOC hysteresis.
 *
 * The hysteresis only widens the range in which an already running controller
 * keeps charging, so a battery hovering around its minimum SOC does not toggle
 * the charge release every cycle.
 *
 * @param input Battery configuration, measurement, and previous readiness
 * @returns Whether EV surplus charging may proceed
 */
export function evaluateBatteryAvailability(input: BatteryAvailabilityInput): BatteryAvailabilityDecision {
	if (input.mode === "disabled") {
		return { ready: true, reason: "disabled", batterySoc: null };
	}
	if (
		typeof input.batterySoc !== "number" ||
		!Number.isFinite(input.batterySoc) ||
		input.batterySoc < 0 ||
		input.batterySoc > 100 ||
		typeof input.minimumBatterySoc !== "number" ||
		!Number.isFinite(input.minimumBatterySoc) ||
		input.minimumBatterySoc < 0 ||
		input.minimumBatterySoc > 100
	) {
		return { ready: false, reason: "invalid", batterySoc: null };
	}
	if (
		input.maximumAgeSeconds > 0 &&
		(input.batterySocAgeMs === null ||
			!Number.isFinite(input.batterySocAgeMs) ||
			input.batterySocAgeMs < 0 ||
			input.batterySocAgeMs > input.maximumAgeSeconds * 1000)
	) {
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

/**
 * Calculates the PV surplus power in watts that may be used for charging, independent of the
 * phase count. This is the numerator behind {@link calculateOptimalChargeCurrent} and is also
 * used to decide one-/three-phase switching, where the power - not the current - is the signal.
 *
 * @param input Current energy-management inputs without the per-wallbox current and phase count
 * @returns The available surplus power in watts, or `null` if an input is invalid
 */
export function calculateAvailableSurplusPower(input: FleetSurplusInput): number | null {
	const numericInputs = [input.solarPower, input.houseConsumption, input.chargerPower, input.reservePower, input.maximumBatteryBonus];
	if (!numericInputs.every(value => Number.isFinite(value)) || input.reservePower < 0 || input.maximumBatteryBonus < 0) {
		return null;
	}
	// a disabled home battery contributes nothing, so its SOC is allowed to be absent
	if (
		input.batteryMode !== "disabled" &&
		(input.batterySoc === null ||
			!Number.isFinite(input.batterySoc) ||
			input.batterySoc < 0 ||
			input.batterySoc > 100 ||
			!Number.isFinite(input.minBatterySoc) ||
			input.minBatterySoc < 0 ||
			input.minBatterySoc > 100)
	) {
		return null;
	}

	// only the priority mode releases battery power to the EV; the bonus never turns negative
	// below the minimum SOC, that range is handled by evaluateBatteryAvailability instead
	const batteryOffset =
		input.batteryMode === "priority" && input.batterySoc !== null && input.minBatterySoc < 100
			? Math.max(0, (input.maximumBatteryBonus / (100 - input.minBatterySoc)) * (input.batterySoc - input.minBatterySoc))
			: 0;
	const surplus = input.solarPower - input.houseConsumption + (input.subtractChargerPower ? input.chargerPower : 0) - input.reservePower + batteryOffset;
	if (typeof input.supplyLimit !== "number" || !Number.isFinite(input.supplyLimit)) {
		return surplus;
	}
	// the learned supply limit covers the whole house; the rest of the house load is served first
	const otherLoad = input.subtractChargerPower ? input.houseConsumption - input.chargerPower : input.houseConsumption;
	return Math.min(surplus, input.supplyLimit - otherLoad - input.reservePower);
}

/**
 * Whether the learned supply limit, not the surplus formula, sets the available power.
 *
 * @param input Current energy-management inputs including the supply limit
 * @returns `true` only when both values are valid and the limit is the lower one
 */
export function isSupplyLimited(input: FleetSurplusInput): boolean {
	const limited = calculateAvailableSurplusPower(input);
	const unlimited = calculateAvailableSurplusPower({ ...input, supplyLimit: null });
	return limited !== null && unlimited !== null && limited < unlimited;
}

/**
 * Calculates the optimal charging current and keeps the internal controller
 * target within its valid range. A target of 0 A means that charging should be
 * disabled; it must never be sent to the charger as a current setting.
 *
 * @param input Current energy-management inputs
 * @returns A target between 0 and the configured maximum, or `null` if an input is invalid
 */
export function calculateOptimalChargeCurrent(input: ChargeCalculationInput): number | null {
	if (
		!Number.isFinite(input.phases) ||
		!Number.isFinite(input.maximumChargeCurrent) ||
		(input.phases !== 1 && input.phases !== 3) ||
		!Number.isInteger(input.maximumChargeCurrent) ||
		// a per-wallbox limit may legitimately sit below the 10 A start current, e.g. an 8 A
		// coded cable, so only the technical floor makes a maximum invalid
		input.maximumChargeCurrent < MIN_CHARGE_CURRENT ||
		input.maximumChargeCurrent > MAX_CHARGE_CURRENT
	) {
		return null;
	}
	const availablePower = calculateAvailableSurplusPower(input);
	if (availablePower === null) {
		return null;
	}
	const calculatedCurrent = Math.floor(availablePower / PHASE_VOLTAGE / input.phases);

	return Math.max(0, Math.min(calculatedCurrent, input.maximumChargeCurrent));
}

/**
 * The current the ramp has to reach before the charge release is given.
 *
 * Charging starts at {@link START_CHARGE_CURRENT} to keep the release from flapping around the
 * technical minimum, but a wallbox capped below that can never reach it - such a wallbox starts at
 * its own maximum instead.
 *
 * @param minimum Lowest current the ChargeManager may assign to this wallbox
 * @param maximum Highest current the ChargeManager may assign to this wallbox
 * @returns The current at which charging is released
 */
export function resolveStartChargeCurrent(minimum: number, maximum: number): number {
	return Math.min(Math.max(START_CHARGE_CURRENT, minimum), maximum);
}

/**
 * Ampere gap the newly calculated target must have from the current one before the charging
 * current follows it. A one-ampere gap is what a passing cloud produces, and following it makes
 * the charger hunt around the target instead of tracking it.
 */
export const CURRENT_DEADBAND = 2;

/**
 * Moves the internal target current by at most one ampere per control cycle, and only once the
 * newly calculated target is at least {@link CURRENT_DEADBAND} amperes away.
 *
 * The ends of the usable range are followed exactly regardless of the deadband, or the deadband
 * would make them unreachable: stopping (0 A), ramping up to a raised minimum or to the start
 * current, and the configured maximum. Inside the range a one-ampere target change is ignored, so the charger settles instead
 * of stepping back and forth every cycle.
 *
 * Known limit: while the target oscillates between the maximum and one ampere below it, the
 * current ratchets up to the maximum and stays there. Capping that would cost the top ampere of
 * every charge, which is the worse trade.
 *
 * @param current Previous internal target
 * @param target Newly calculated target
 * @param maximum Maximum current allowed by the ChargeManager
 * @param minimum Minimum current allowed by the ChargeManager
 * @param followDown Follow a downward gap of one ampere as well - set while the learned supply
 *        limit sets the target, because the ampere the deadband keeps is drawn from the grid there
 * @returns A finite target between 0 and the configured maximum
 */
export function stepChargeCurrent(current: number, target: number, maximum = MAX_CHARGE_CURRENT, minimum = MIN_CHARGE_CURRENT, followDown = false): number {
	const safeMaximum = Number.isInteger(maximum) && maximum >= MIN_CHARGE_CURRENT && maximum <= MAX_CHARGE_CURRENT ? maximum : MAX_CHARGE_CURRENT;
	const safeMinimum = Number.isInteger(minimum) && minimum >= MIN_CHARGE_CURRENT && minimum <= safeMaximum ? minimum : MIN_CHARGE_CURRENT;
	const safeCurrent = Number.isFinite(current) ? Math.max(0, Math.min(Math.trunc(current), safeMaximum)) : 0;
	const safeTarget = Number.isFinite(target) ? Math.max(0, Math.min(Math.trunc(target), safeMaximum)) : 0;

	const gap = safeTarget - safeCurrent;
	if (gap === 0) {
		return safeCurrent;
	}
	// the step onto the start current releases the charge; a target of exactly that current
	// would otherwise leave the ramp one ampere short of it for good
	const start = resolveStartChargeCurrent(safeMinimum, safeMaximum);
	const reachesStart = safeCurrent < start && safeTarget >= start;
	const atRangeEnd = safeTarget <= safeMinimum || safeTarget === safeMaximum || reachesStart;
	if (atRangeEnd || Math.abs(gap) >= CURRENT_DEADBAND || (followDown && gap < 0)) {
		return safeCurrent + Math.sign(gap);
	}
	return safeCurrent;
}

/**
 * Advances the consecutive insufficient-surplus counter and resets it as soon
 * as the minimum charging current is available again.
 *
 * @param current Current internal charging target
 * @param minimum Minimum charger current
 * @param previousDelay Previous insufficient-surplus cycle count
 * @returns Updated consecutive insufficient-surplus cycle count
 */
export function updateShutdownDelay(current: number, minimum: number, previousDelay: number): number {
	if (!Number.isFinite(current) || !Number.isFinite(minimum) || current >= minimum) {
		return 0;
	}
	const safePreviousDelay = Number.isFinite(previousDelay) ? Math.max(0, Math.trunc(previousDelay)) : 0;
	return safePreviousDelay + 1;
}

/**
 * Produces the complete ChargeManager decision for one control cycle without
 * reading ioBroker states or sending charger commands.
 *
 * The function intentionally preserves the existing controller behavior:
 * current changes by at most 1 A per cycle, charging starts at 10 A, and an
 * insufficient-surplus shutdown happens after 12 completed delay cycles. Once the charger
 * reports the release, every current from the minimum up is written.
 *
 * @param input Current measurements and previous controller state
 * @returns Requested transport action and state for the next cycle
 */
export function decideChargeManager(input: ChargeManagerControllerInput): ChargeManagerDecision {
	const optimalCurrent = calculateOptimalChargeCurrent(input);
	if (
		optimalCurrent === null ||
		!Number.isInteger(input.minimumChargeCurrent) ||
		input.minimumChargeCurrent < MIN_CHARGE_CURRENT ||
		input.minimumChargeCurrent > input.maximumChargeCurrent
	) {
		return {
			action: "disable",
			reason: "invalid-input",
			optimalCurrent: null,
			nextState: { currentAmp: 0, shutdownDelay: 0 },
		};
	}

	const supplyLimited = isSupplyLimited(input);
	const tagged = (decision: ChargeManagerDecision): ChargeManagerDecision => (supplyLimited ? { ...decision, supplyLimited: true } : decision);
	const currentAmp = stepChargeCurrent(input.state.currentAmp, optimalCurrent, input.maximumChargeCurrent, input.minimumChargeCurrent, supplyLimited);
	const startChargeCurrent = resolveStartChargeCurrent(input.minimumChargeCurrent, input.maximumChargeCurrent);
	// while ramping up to a raised minimum current the target is briefly below the minimum;
	// do not count that as an insufficient-surplus cycle
	const isRampingToRaisedMinimum =
		input.minimumChargeCurrent > START_CHARGE_CURRENT && optimalCurrent >= input.minimumChargeCurrent && currentAmp < input.minimumChargeCurrent;
	let shutdownDelay = isRampingToRaisedMinimum ? 0 : updateShutdownDelay(currentAmp, input.minimumChargeCurrent, input.state.shutdownDelay);

	// the start current only guards the release; with the start as the floor a running charge kept
	// the current written last while the ramp went down to the minimum (2026-09-26 17:50)
	if (currentAmp >= (input.released === true ? input.minimumChargeCurrent : startChargeCurrent)) {
		return tagged({
			action: "enable",
			reason: "charging-current",
			optimalCurrent,
			nextState: { currentAmp, shutdownDelay },
		});
	}

	if (currentAmp < input.minimumChargeCurrent) {
		if (shutdownDelay > SHUTDOWN_DELAY_CYCLES) {
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

/**
 * Grid import in watts above which the house counts as drawing from the grid while the
 * ChargeManager charges. Known limit: fixed; a control deviation of the inverter below it is
 * tolerated.
 */
export const GRID_IMPORT_THRESHOLD_W = 150;

/**
 * Consecutive cycles above {@link GRID_IMPORT_THRESHOLD_W} before an existing supply limit is lowered,
 * and the minimum before a first one is learned.
 */
export const GRID_IMPORT_CYCLES = 2;

/**
 * How long the grid import has to persist before a first supply limit is learned. The GoodWe took
 * 50 s to follow a car start on 2026-10-03 while its battery turned from charging to discharging;
 * a limit learned from that throttled a charge the installation could carry.
 */
export const GRID_IMPORT_MIN_MS = 120000;

/**
 * Watts per minute the learned supply limit rises while no grid import is seen. Known limit: fixed;
 * while the bottleneck persists, every step up costs a grid import of one ampere for two cycles.
 */
export const SUPPLY_LIMIT_RELAX_W_PER_MIN = 250;

/** Supply limit carried between ChargeManager cycles. */
export interface SupplyLimitState {
	/** Highest total house draw in watts the installation delivered without the grid; `null` without a limit */
	limit: number | null;
	/** Consecutive cycles with grid import above the threshold while the ChargeManager wallboxes drew power */
	importCycles: number;
}

/** Measurements for one {@link updateSupplyLimit} step. */
export interface SupplyLimitInput {
	/** Raw value of the grid-import state in watts, import positive; anything but a finite number counts as no import */
	gridImport: unknown;
	/** Current household consumption in watts */
	houseConsumption: number;
	/** Summed consumption of the wallboxes run by the ChargeManager in watts */
	chargerPower: number;
	/** Whether the wallbox consumption is already part of the household consumption */
	subtractChargerPower: boolean;
	/** Grid reserve power in watts */
	reservePower: number;
	/** Power of all ChargeManager wallboxes at their maximum current on three phases in watts */
	maximumFleetPower: number;
	/** Control cycle time in milliseconds */
	cycleTimeMs: number;
}

/** Result of one {@link updateSupplyLimit} step. */
export interface SupplyLimitUpdate {
	/** State for the next cycle */
	state: SupplyLimitState;
	/** `created` when a limit appears, `released` when it is dropped, otherwise `null` */
	event: "created" | "released" | null;
}

/**
 * Learns how much power the installation delivers without the grid and relaxes that limit again.
 *
 * The ChargeManager surplus (PV − house + battery bonus) can exceed what the installation delivers:
 * a hybrid inverter caps PV and battery together (GoodWe GW10KN-ET at about 9 kW AC on 2026-09-28),
 * the battery has a discharge limit, or it is empty. The difference then comes from the grid. When
 * the import stays above {@link GRID_IMPORT_THRESHOLD_W} while the ChargeManager wallboxes draw
 * power, for {@link GRID_IMPORT_MIN_MS} before a first limit and {@link GRID_IMPORT_CYCLES} cycles
 * for a lower one, the total house draw minus the import is taken as the limit. Without import the limit rises by {@link SUPPLY_LIMIT_RELAX_W_PER_MIN}, and it is dropped
 * once it no longer caps the maximum current.
 *
 * @param previous State from the previous cycle
 * @param input Measurements of this cycle
 * @returns The state for the next cycle and whether a limit appeared or was dropped
 */
export function updateSupplyLimit(previous: SupplyLimitState, input: SupplyLimitInput): SupplyLimitUpdate {
	const gridImport = typeof input.gridImport === "number" && Number.isFinite(input.gridImport) ? input.gridImport : null;
	const measured = Number.isFinite(input.houseConsumption) && Number.isFinite(input.chargerPower);
	const totalDraw = input.subtractChargerPower ? input.houseConsumption : input.houseConsumption + input.chargerPower;
	const importing = measured && gridImport !== null && gridImport > GRID_IMPORT_THRESHOLD_W && input.chargerPower > 0;
	const previousCycles = Number.isFinite(previous.importCycles) ? Math.max(0, Math.trunc(previous.importCycles)) : 0;
	const importCycles = importing ? previousCycles + 1 : 0;
	const cycleTimeMs = Number.isFinite(input.cycleTimeMs) && input.cycleTimeMs > 0 ? input.cycleTimeMs : 0;
	const neededCycles =
		previous.limit === null && cycleTimeMs > 0 ? Math.max(GRID_IMPORT_CYCLES, Math.ceil(GRID_IMPORT_MIN_MS / cycleTimeMs)) : GRID_IMPORT_CYCLES;

	if (importing && importCycles >= neededCycles) {
		return { state: { limit: totalDraw - gridImport, importCycles: 0 }, event: previous.limit === null ? "created" : null };
	}
	if (previous.limit === null || importCycles > 0) {
		// no limit yet, or the import has not lasted long enough: neither learn nor relax
		return { state: { limit: previous.limit, importCycles }, event: null };
	}

	const limit = previous.limit + (SUPPLY_LIMIT_RELAX_W_PER_MIN * cycleTimeMs) / 60000;
	const otherLoad = totalDraw - input.chargerPower;
	if (measured && Number.isFinite(input.maximumFleetPower) && limit - otherLoad - input.reservePower >= input.maximumFleetPower) {
		return { state: { limit: null, importCycles: 0 }, event: "released" };
	}
	return { state: { limit, importCycles: 0 }, event: null };
}

/** One wallbox taking part in the shared surplus allocation. */
export interface FleetParticipant {
	/** Number of active charging phases */
	phases: number;
	/** Lowest current the ChargeManager may assign to this wallbox */
	minimumChargeCurrent: number;
	/** Highest current the ChargeManager may assign to this wallbox */
	maximumChargeCurrent: number;
	/** Internal controller state from the previous cycle */
	state: ChargeManagerState;
	/**
	 * Whether this wallbox can actually consume power right now (a vehicle is connected).
	 * A wallbox without a vehicle still gets its regular decision but reserves nothing,
	 * so it never starves a wallbox that has a car waiting.
	 */
	claimsPower: boolean;
	/** The charger reports the charge release (`frc` 2) */
	released?: boolean;
}

/** Shared measurements for one fleet-wide ChargeManager cycle; the per-wallbox parts live in {@link FleetParticipant}. */
export type FleetSurplusInput = Omit<ChargeCalculationInput, "maximumChargeCurrent" | "phases">;

/** A per-wallbox {@link ChargeManagerDecision} plus the raw surplus power it was offered, for the phase-switch decision. */
export interface FleetChargeDecision extends ChargeManagerDecision {
	/** PV surplus power in watts available to this wallbox at its current phase count (0 when the inputs are invalid) */
	availablePower: number;
}

/**
 * Splits the available PV surplus across several wallboxes and returns one control
 * decision per wallbox.
 *
 * The surplus is a single shared resource: without coordination every wallbox would
 * calculate its target from the full surplus and they would collectively draw far more
 * than is available. Wallboxes are served in list order, so the first entry has the
 * highest priority and later ones only see what is left over. The power a wallbox is
 * entitled to is reserved even while it is still ramping up, otherwise the next wallbox
 * would claim the same watts for one cycle and both would overshoot.
 *
 * `chargerPower` in `shared` must be the summed consumption of all coordinated wallboxes,
 * so that `subtractChargerPower` adds the whole fleet back to the household consumption.
 *
 * A single participant receives exactly the result of {@link decideChargeManager}.
 *
 * @param shared Measurements and configuration common to every wallbox
 * @param participants Wallboxes to serve, highest priority first
 * @returns One decision per participant, in the same order
 */
export function decideChargeManagerFleet(shared: FleetSurplusInput, participants: FleetParticipant[]): FleetChargeDecision[] {
	let claimedPower = 0;

	return participants.map(participant => {
		// later wallboxes only see the surplus the earlier ones did not claim
		const surplus: FleetSurplusInput = {
			...shared,
			solarPower: shared.solarPower - claimedPower,
			// the supply limit is shared the same way: later wallboxes only get what the earlier ones left
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
		// the raw surplus power offered to this wallbox drives its one-/three-phase decision
		const availablePower = calculateAvailableSurplusPower(surplus) ?? 0;

		if (participant.claimsPower) {
			// reserve the larger of what this wallbox wants and what it still draws while ramping down
			const reservedCurrent = Math.max(decision.optimalCurrent ?? 0, decision.nextState.currentAmp);
			claimedPower += reservedCurrent * PHASE_VOLTAGE * participant.phases;
		}

		return { ...decision, availablePower };
	});
}

/** Input for the automatic one-/three-phase switching decision of a single wallbox. */
export interface PhaseSwitchInput {
	/** Number of phases the wallbox is charging with right now (1 or 3) */
	currentPhases: number;
	/** PV surplus power available to this wallbox in watts, independent of the phase count */
	availablePower: number;
	/** Lowest current the ChargeManager may assign to this wallbox */
	minimumChargeCurrent: number;
	/** Highest current the ChargeManager may assign to this wallbox */
	maximumChargeCurrent: number;
	/** Consecutive cycles the pending switch condition has already held */
	switchDelay: number;
	/** Cycles the condition must hold before switching up (default {@link PHASE_SWITCH_DELAY_CYCLES}) */
	upDelayCycles?: number;
	/** Cycles the condition must hold before switching down (default {@link PHASE_SWITCH_DELAY_CYCLES}) */
	downDelayCycles?: number;
	/** No switch at all, e.g. while the charger's own wait after the last switch is still running */
	blocked?: boolean;
	/** The charger is not charging yet, so the ramp must reach the start current before it does */
	waitingForStart?: boolean;
}

/** Result of the automatic phase-switching decision. */
export interface PhaseSwitchDecision {
	/** Phase count the wallbox should charge with (1 or 3); equals the current count until the dwell time elapsed */
	targetPhases: number;
	/** Updated consecutive-cycle counter for the pending switch (0 when no switch is pending) */
	switchDelay: number;
}

/**
 * Decides whether a wallbox should switch between one-phase and three-phase charging.
 *
 * Three-phase charging raises both the floor (it needs at least `minimumChargeCurrent`
 * on every phase) and the ceiling, so the decision is driven by the surplus power:
 * switch up to three phases once one-phase charging is saturated, and back down once the
 * surplus can no longer sustain the three-phase minimum. The gap between those two
 * thresholds plus a dwell time of {@link PHASE_SWITCH_DELAY_CYCLES} cycles keeps a wallbox
 * from flapping between phase modes, which would interrupt charging each time.
 *
 * The up threshold is floored at the three-phase minimum times {@link PHASE_SWITCH_HYSTERESIS},
 * never at the bare minimum: flooring it there gives a band of width zero, and the surplus then
 * crosses a single threshold in both directions. That is the case for every wallbox whose
 * maximum is at most three times its minimum - with 8-16 A both thresholds land on 5520 W.
 * The factor also means three-phase charging starts with headroom above its own floor instead
 * of right on it, where the next cloud drops it below again.
 *
 * Switching down also needs enough surplus for one-phase charging at the minimum. Below that,
 * one phase would not charge either: the switch would only cost a pause - and on the go-e it can
 * leave the charger stuck in "min pause duration" until it is restarted (2026-09-22: a switch at
 * 571 W with nothing charging). The controller stops charging instead, and the switch happens
 * once one-phase charging can actually start.
 *
 * Before the charge has started, the floor is the start current instead of the minimum: the ramp
 * releases the charge only there. With the minimum as the floor, a surplus between the three-phase
 * minimum and the three-phase start kept the charger on three phases, where it never started,
 * although one phase could have charged at full current (2026-09-25: 6831 W, 8-16 A). The switch
 * is only planned then, not written (see {@link mayWritePhaseSwitch}), so both directions use the
 * same threshold without a band.
 *
 * @param input Current phase count, available surplus power and the pending-switch counter
 * @returns The phase count to use next cycle and the updated dwell counter
 */
export function decidePhaseSwitch(input: PhaseSwitchInput): PhaseSwitchDecision {
	if (
		input.blocked === true ||
		(input.currentPhases !== 1 && input.currentPhases !== 3) ||
		!Number.isFinite(input.availablePower) ||
		!Number.isFinite(input.minimumChargeCurrent) ||
		!Number.isFinite(input.maximumChargeCurrent)
	) {
		return { targetPhases: input.currentPhases, switchDelay: 0 };
	}

	const floorCurrent = input.waitingForStart ? resolveStartChargeCurrent(input.minimumChargeCurrent, input.maximumChargeCurrent) : input.minimumChargeCurrent;
	const threePhaseMinPower = floorCurrent * 3 * PHASE_VOLTAGE;
	// during a charge the up threshold keeps a real distance from the three-phase minimum, so the
	// band never inverts and never collapses to a single value the surplus crosses in both directions
	const upThreshold = Math.max(
		input.maximumChargeCurrent * PHASE_VOLTAGE,
		input.waitingForStart ? threePhaseMinPower : threePhaseMinPower * PHASE_SWITCH_HYSTERESIS,
	);

	let targetPhases = input.currentPhases;
	if (input.currentPhases === 1 && input.availablePower >= upThreshold) {
		targetPhases = 3;
	} else if (input.currentPhases === 3 && input.availablePower < threePhaseMinPower && input.availablePower >= floorCurrent * PHASE_VOLTAGE) {
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
	// condition holds but the dwell time has not elapsed yet - keep the current phase count
	return { targetPhases: input.currentPhases, switchDelay };
}

function validDelayCycles(cycles: number | undefined): number {
	return cycles !== undefined && Number.isFinite(cycles) && cycles >= 0 ? Math.trunc(cycles) : PHASE_SWITCH_DELAY_CYCLES;
}

/** go-e default for `mptwt`, the minimum time between two phase switches */
export const DEFAULT_PHASE_TOGGLE_WAIT_MS = 10 * 60 * 1000;

/**
 * A pause setting the charger reports (`mptwt`), or the go-e default when the value is missing or
 * unusable.
 *
 * @param value Reported value in milliseconds
 * @param fallback Default in milliseconds
 * @returns The pause in milliseconds
 */
export function chargerPauseMs(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Controller state for a ChargeManager that takes over a charger - at adapter start, or when it
 * is switched on after ChargeNOW or manual charging.
 *
 * A vehicle that is already charging is taken over at the current it charges with. Starting the
 * ramp at 0 A instead would count the ramp-up as insufficient surplus and withdraw a release
 * that was working fine; state carried over from an earlier run is just as wrong, so the
 * shutdown delay always starts from zero.
 *
 * @param reportedAllow Charge release the charger reports (`alw`, 1 = released)
 * @param reportedAmp Charging current the charger reports (`amp`)
 * @param minimum Lowest current the ChargeManager may assign to this wallbox
 * @param maximum Highest current the ChargeManager may assign to this wallbox
 * @returns The state to start the controller with
 */
export function seedChargeManagerState(
	reportedAllow: number | undefined,
	reportedAmp: number | undefined,
	minimum: number,
	maximum: number,
): ChargeManagerState {
	if (reportedAllow !== 1 || !Number.isFinite(reportedAmp) || (reportedAmp as number) <= 0) {
		return { currentAmp: 0, shutdownDelay: 0 };
	}
	return { currentAmp: Math.min(Math.max(Math.trunc(reportedAmp as number), minimum), maximum), shutdownDelay: 0 };
}

/** go-e `frc` (forceState) value for "neutral": the charger follows its own default and charges any vehicle */
export const FORCE_STATE_NEUTRAL = 0;
/** go-e `frc` (forceState) value that forces charging on - what the adapter's release sets */
export const FORCE_STATE_ON = 2;

/**
 * The charge release to compare a write against, from what the charger reports.
 *
 * With `frc` 0 the reported `alw` is the charger's own decision, not a release anybody gave: a
 * charger that says "not released" there still charges the next vehicle plugged in. So there is
 * no readback, and the adapter's own release or withdrawal is always sent.
 *
 * @param reportedAllow Charge release the charger reports (`alw`, 1 = released)
 * @param forceState `frc` the charger reports
 * @returns The release to compare against, `undefined` while the charger decides itself
 */
export function releaseReadback(reportedAllow: number | undefined, forceState: unknown): number | undefined {
	return forceState === FORCE_STATE_NEUTRAL ? undefined : reportedAllow;
}

/**
 * Whether the ChargeManager has to hold off a charger it gives no release.
 *
 * In force state neutral the charger decides by itself and charges any vehicle. Firmware 60.6
 * comes back from every restart with `frc` 0, the go-e app sets it when a setting is saved, and
 * firmware 59.4 and 60.6 set it themselves when a vehicle is unplugged. The next vehicle then
 * charged at full power from the grid until the shutdown delay withdrew the release - 6.1 kW for
 * 70 seconds on 2026-09-22. A release the adapter gave itself stays, so a restart during a PV
 * charge does not interrupt it.
 *
 * @param forceState `frc` the charger reports
 * @param releasedByAdapter Whether the adapter's last request was a charge release
 * @returns `true` for `frc` 0 without a release from the adapter
 */
export function enforceOffState(forceState: unknown, releasedByAdapter: boolean): boolean {
	return releasedByAdapter !== true && forceState === FORCE_STATE_NEUTRAL;
}

/**
 * Phase count the ChargeManager plans with: the one decided or requested but not written yet -
 * a phase switch waits for the charge release - otherwise the one the charger reports.
 *
 * @param pendingPhases Decided or requested phase count, `null` if none
 * @param enabledPhases Phase count the charger reports
 * @returns The phase count to size the charging current for
 */
export function planningPhases(pendingPhases: number | null, enabledPhases: number): number {
	return pendingPhases === 1 || pendingPhases === 3 ? pendingPhases : enabledPhases;
}

/**
 * Whether a phase switch may be written to the charger now.
 *
 * The phase count only matters once the charger charges. A switch while it is held off is never
 * needed, and it starts the charger's minimum time between two switches (`mptwt`, 10 minutes by
 * default), which can then block the switch the start really needs if the surplus has moved on
 * in the meantime. Each write also wakes the charger. On top of that, a switch while held off
 * left the go-e hanging in "min pause duration" for hours on 2026-09-22 (12:33 and 18:46), while a
 * switch during a charge went through within 20 seconds. So the switch waits until the release is
 * active, and a switch that would be followed by a withdrawal right away is not written at all.
 *
 * @param forceState `frc` the charger reports
 * @param action What the ChargeManager does with the charger this cycle
 * @returns `true` only while charging is forced on and not about to be switched off
 */
export function mayWritePhaseSwitch(forceState: unknown, action: ChargeManagerAction): boolean {
	return forceState === FORCE_STATE_ON && action !== "disable";
}

/**
 * Cycles a phase-switch condition must hold before the switch is planned.
 *
 * The dwell protects a running charge from being interrupted again and again. While the charger
 * is held off a switch is only planned, not written, so it costs nothing and follows the surplus
 * at once - on 2026-09-23 the dwell alone held back a PV start by three minutes.
 *
 * @param delayMs Dwell for a switch during a charge
 * @param cycleTimeMs Poll cycle time
 * @param forceState `frc` the charger reports
 * @returns The dwell in cycles, 0 while charging is not forced on
 */
export function phaseSwitchDwellCycles(delayMs: number, cycleTimeMs: number, forceState: unknown): number {
	return forceState === FORCE_STATE_ON ? Math.ceil(delayMs / cycleTimeMs) : 0;
}

/**
 * What the ChargeManager is doing while it holds the charger as it is (`hold`), for the charge state.
 *
 * "Ramping up" only applies when the surplus would carry at least the minimum current; otherwise
 * the ramp never reaches the start and the state used to flip between "ramping up at 0 A" and
 * "not enough PV surplus" every two minutes all night.
 *
 * @param optimalCurrent Current the surplus would carry
 * @param minimumCurrent Lowest current the ChargeManager may assign to this wallbox
 * @param released Whether the charge release the adapter gave is active
 * @returns `charging` for a running charge, `ramping` towards the start current, or `not-enough`
 */
export function describeHold(optimalCurrent: number, minimumCurrent: number, released: boolean): "charging" | "ramping" | "not-enough" {
	if (!Number.isFinite(optimalCurrent) || !Number.isFinite(minimumCurrent) || optimalCurrent < minimumCurrent) {
		return "not-enough";
	}
	return released ? "charging" : "ramping";
}

/** Phase-switch inputs of a wallbox with automatic phase switching. */
export interface FleetPhaseInput {
	/** Phase count the charger reports (1 or 3; anything else is never switched) */
	currentPhases: number;
	/** Consecutive cycles the pending switch condition has already held */
	switchDelay: number;
	/** Cycles the condition must hold before switching up */
	upDelayCycles?: number;
	/** Cycles the condition must hold before switching down */
	downDelayCycles?: number;
	/** No switch at all this cycle */
	blocked?: boolean;
	/** The charger is not charging yet, so the ramp must reach the start current before it does */
	waitingForStart?: boolean;
}

/**
 * Splits the surplus across the fleet and decides the automatic phase switching in one step.
 *
 * The phase decision needs the surplus each wallbox is offered, so the fleet is allocated first.
 * When a wallbox switches phases, the allocation runs again with the new phase count: the switch
 * reaches the charger in this very cycle, and a current sized for the old count withdrew the
 * release on top of the switch (three-phase 3394 W is 4 A, below the minimum; one-phase it is
 * 14 A). A switch up also carries the ramp over at the power charged so far, at least the minimum:
 * stepping down from the one-phase amperes drew three phases at 15 A, 10.3 kW on 7.1 kW surplus
 * (2026-10-06 12:26:17). A switch down carries the power over as well, capped at what the surplus
 * and the maximum carry on the new phase count: keeping the three-phase amperes left a vehicle
 * plugged in on stale three phases at 4 A one-phase, a minute short of the start (2026-10-07 17:35:29).
 *
 * A wallbox whose shutdown delay runs out while one phase could carry its charge switches down at
 * once instead of stopping: the switch costs the charge a short pause, the stop all of it.
 *
 * @param shared Surplus inputs shared by the whole fleet
 * @param participants Wallboxes in priority order, with their current phase count
 * @param phaseInputs Per wallbox the phase-switch inputs, or `null` without automatic switching
 * @returns The charge decisions, and per wallbox the phase decision (`null` without automatic switching)
 */
export function planChargeManagerFleet(
	shared: FleetSurplusInput,
	participants: FleetParticipant[],
	phaseInputs: (FleetPhaseInput | null)[],
): { decisions: FleetChargeDecision[]; phases: (PhaseSwitchDecision | null)[] } {
	const decisions = decideChargeManagerFleet(shared, participants);
	const phases = phaseInputs.map((phaseInput, index) =>
		phaseInput
			? decidePhaseSwitch({
					currentPhases: phaseInput.currentPhases,
					availablePower: decisions[index].availablePower,
					minimumChargeCurrent: participants[index].minimumChargeCurrent,
					maximumChargeCurrent: participants[index].maximumChargeCurrent,
					switchDelay: phaseInput.switchDelay,
					upDelayCycles: phaseInput.upDelayCycles,
					// the shutdown delay runs out before the down dwell does, so a charge one phase could
					// carry was stopped instead of switched (2026-09-26 12:22:43)
					downDelayCycles: decisions[index].reason === "insufficient-surplus" ? 0 : phaseInput.downDelayCycles,
					blocked: phaseInput.blocked,
					waitingForStart: phaseInput.waitingForStart,
				})
			: null,
	);
	const switched = phases.some((phase, index) => phase && phase.targetPhases !== phaseInputs[index]?.currentPhases);
	if (!switched) {
		return { decisions, phases };
	}
	const switchedParticipants = participants.map((participant, index) => {
		const targetPhases = phases[index]?.targetPhases || participant.phases;
		if (targetPhases === participant.phases) {
			return participant;
		}
		// the ramp goes on from the power charged so far, not from the amperes of the old phase count
		const { currentAmp } = participant.state;
		const samePower = Math.floor((currentAmp * participant.phases) / targetPhases);
		const carried =
			targetPhases > participant.phases
				? Math.min(currentAmp, Math.max(participant.minimumChargeCurrent, samePower))
				: Math.min(samePower, Math.floor(decisions[index].availablePower / PHASE_VOLTAGE / targetPhases), participant.maximumChargeCurrent);
		return { ...participant, phases: targetPhases, state: { ...participant.state, currentAmp: carried } };
	});
	return { decisions: decideChargeManagerFleet(shared, switchedParticipants), phases };
}

/**
 * Returns the go-e phase mode (`psm`: 1 = one phase, 2 = three phases) to send, or `null` when the
 * charger already reports the requested mode. `psm` is a stored setting, so it is not rewritten
 * every cycle.
 *
 * @param charge3Phase Whether three-phase charging is requested
 * @param enabledPhases Phase count the charger last reported (1 or 3; 0 = automatic or unknown)
 * @returns The `psm` value to send, or `null` if nothing needs to be sent
 */
export function phaseModeToSend(charge3Phase: boolean, enabledPhases: number): 1 | 2 | null {
	if (enabledPhases === (charge3Phase ? 3 : 1)) {
		return null;
	}
	return charge3Phase ? 2 : 1;
}

/** `Settings.PhaseMode` value for automatic switching; 1 and 3 fix the phase count */
export const PHASE_MODE_AUTO = 0;

/**
 * Resolves a user write to `Settings.PhaseMode`.
 *
 * @param value The written value: 1 or 3 fixes the phase count, {@link PHASE_MODE_AUTO} selects automatic switching
 * @param autoAllowed Whether automatic switching is enabled for this wallbox in the instance settings (and supported)
 * @returns Whether automatic switching is on and, for a fixed mode, the manual phase request; `null` rejects the write
 */
export function resolvePhaseModeWrite(value: unknown, autoAllowed: boolean): { auto: boolean; charge3Phase?: boolean } | null {
	if (value === 1 || value === 3) {
		return { auto: false, charge3Phase: value === 3 };
	}
	if (value === PHASE_MODE_AUTO && autoAllowed) {
		return { auto: true };
	}
	return null;
}

/**
 * Returns the `Settings.PhaseMode` value that matches the current settings.
 *
 * @param auto Whether automatic switching is on
 * @param charge3Phase The manual phase request (`Settings.Charge3Phase`)
 * @returns The mode: 1, 3 or {@link PHASE_MODE_AUTO}
 */
export function phaseModeOf(auto: boolean, charge3Phase: boolean): number {
	return auto ? PHASE_MODE_AUTO : charge3Phase ? 3 : 1;
}

/** How long a connected vehicle may ignore an active charge release before it is withdrawn */
export const IDLE_RELEASE_DELAY_MS = 5 * 60 * 1000;
/** Charging power below which a connected vehicle counts as not charging */
export const IDLE_CHARGE_POWER = 100;

/** Idle-release tracking carried between control cycles. */
export interface IdleReleaseState {
	/** Consecutive cycles the vehicle ignored the active release */
	idleDelay: number;
	/** Release was withdrawn because the vehicle stopped charging; blocks re-enabling */
	latched: boolean;
}

/** Inputs for one idle-release decision. */
export interface IdleReleaseInput {
	/** Whether the charger currently reports an active charge release */
	releaseActive: boolean;
	/** go-e car state (1 = no car, 2 = charging, 3 = waiting for car, 4 = charge finished) */
	carState: number;
	/** Measured charging power in watts */
	chargePower: number;
	/** Action the ChargeManager controller planned for this cycle */
	controllerAction: ChargeManagerAction;
	/** Cycles the vehicle may ignore the release before it is withdrawn */
	delayCycles: number;
	/** State from the previous cycle */
	state: IdleReleaseState;
}

/**
 * Detects a vehicle that stopped drawing power while the charge release is still active.
 * Some vehicles (e.g. Renault Zoe) stay in charging mode as long as the release is held;
 * withdrawing it lets them leave that mode. Once withdrawn, the release stays off until the
 * vehicle is unplugged or the controller itself stops charging for lack of surplus, so the
 * adapter does not toggle the release every few minutes.
 *
 * @param input Measurements, planned action and previous state
 * @returns Whether to withdraw the release now, and the state for the next cycle
 */
export function decideIdleRelease(input: IdleReleaseInput): { withdraw: boolean; nextState: IdleReleaseState } {
	if (input.carState === 1 || input.controllerAction === "disable") {
		return { withdraw: false, nextState: { idleDelay: 0, latched: false } };
	}
	if (input.state.latched) {
		return { withdraw: false, nextState: { idleDelay: 0, latched: true } };
	}
	const idle =
		input.releaseActive &&
		(input.carState === 2 || input.carState === 3 || input.carState === 4) &&
		Number.isFinite(input.chargePower) &&
		input.chargePower < IDLE_CHARGE_POWER;
	if (!idle) {
		return { withdraw: false, nextState: { idleDelay: 0, latched: false } };
	}
	const idleDelay = (Number.isFinite(input.state.idleDelay) ? Math.max(0, Math.trunc(input.state.idleDelay)) : 0) + 1;
	if (idleDelay >= Math.max(1, input.delayCycles)) {
		return { withdraw: true, nextState: { idleDelay: 0, latched: true } };
	}
	return { withdraw: false, nextState: { idleDelay, latched: false } };
}

/**
 * Charging power in watts from the API V1 `nrg` array, whose total power (index 11) is given in
 * units of 10 W.
 *
 * Read once per cycle for every charger, so every check sees this cycle's power. ChargeNOW used a
 * value only the ChargeManager refreshed: 0 W after an adapter restart, which ended a session
 * drawing 7 kW after five minutes as "vehicle stopped drawing power".
 *
 * @param nrg The `nrg` array of the API V1 status
 * @returns The power in watts, or `NaN` for a missing or malformed reading
 */
export function chargePowerFromStatusV1(nrg: unknown): number {
	if (!Array.isArray(nrg) || nrg.length < 12) {
		return Number.NaN;
	}
	const raw: unknown = nrg[11];
	if (typeof raw !== "number" && (typeof raw !== "string" || raw.trim() === "")) {
		return Number.NaN;
	}
	const power = Number(raw) * 10;
	return Number.isFinite(power) ? power : Number.NaN;
}

/**
 * Whether the charger reports that no vehicle is plugged in (go-e car state 1).
 *
 * Unknown or invalid states (0, NaN, out of range) do not count as "no vehicle", so a failed
 * read never silently withdraws a running charge.
 *
 * @param carState go-e car state as reported by the charger
 * @returns `true` only for car state 1
 */
export function isVehicleDisconnected(carState: number): boolean {
	return carState === 1;
}

/**
 * Whether to withdraw the charge release while ChargeNOW and ChargeManager are both switched off.
 *
 * Only a release the adapter gave itself is withdrawn. A release from anywhere else - the go-e
 * app, the button on the charger, the charger's own default after a restart - belongs to the user,
 * and withdrawing it every cycle aborted each charge within seconds until the vehicle gave up.
 *
 * @param chargingAllowed Charge release the charger reports (`Power.ChargingAllowed`)
 * @param releasedByAdapter Whether the release was last given by the adapter
 * @returns `true` only for an active release the adapter gave
 */
export function withdrawReleaseWithModesOff(chargingAllowed: unknown, releasedByAdapter: boolean): boolean {
	return releasedByAdapter === true && chargingAllowed === true;
}

/**
 * Grid frequency as reported by the charger (API V2 key `fhz`).
 *
 * The charger reports 0 while it does not know the frequency; that, a missing key and any
 * malformed value read as unknown, so no made-up 0 Hz is ever published.
 *
 * @param fhz raw `fhz` value from the API V2 status
 * @returns frequency in Hz, or `null` when unknown
 */
export function gridFrequencyFromStatus(fhz: unknown): number | null {
	return typeof fhz === "number" && Number.isFinite(fhz) && fhz > 0 ? fhz : null;
}

/** go-e car state for a vehicle that is plugged in and has finished charging */
export const CAR_STATE_FINISHED = 4;
/** Consecutive ignored charge releases that are still retried on every single cycle */
export const RELEASE_RETRY_LIMIT = 30;
/** After that many ignored releases, the release is only retried every this many cycles */
export const RELEASE_RETRY_INTERVAL = 6;

/**
 * Counts how often in a row the charger kept reporting a charge release other than the one it was
 * last told to apply.
 *
 * The charger answers every write with HTTP 200 and then quietly keeps its own value, so an
 * ignored release looks exactly like a successful one until the next read. On 2026-09-19 that
 * produced 291 consecutive ignored writes over 90 minutes.
 *
 * @param reportedAllow Charge release the charger reports now (`alw`)
 * @param requestedAllow Charge release last written to the charger, or `null` if none was
 * @param previous Consecutive ignored releases so far
 * @returns The updated count; 0 as soon as the charger agrees or nothing was requested
 */
export function updateReleaseRejects(reportedAllow: number, requestedAllow: number | null, previous: number): number {
	if (requestedAllow === null || !Number.isFinite(reportedAllow) || reportedAllow === requestedAllow) {
		return 0;
	}
	return (Number.isFinite(previous) ? Math.max(0, Math.trunc(previous)) : 0) + 1;
}

/**
 * Whether to skip re-sending the charge release this cycle because the charger keeps ignoring it.
 *
 * A vehicle that reports it has finished charging does not necessarily refuse the release for
 * good: in the logged sessions it took it after two to seven consecutive writes, so the repeated
 * writes are what wakes it, not wasted effort. They are only wasted once the vehicle has ignored
 * them for a long while - 2026-09-19 has a stretch of 17 minutes with no reaction at all.
 *
 * So the release is never given up on. It is retried on every cycle for the first
 * {@link RELEASE_RETRY_LIMIT} attempts, which covers every wake-up seen so far with a wide margin,
 * and only then thinned out to every {@link RELEASE_RETRY_INTERVAL} cycles. The vehicle can still
 * wake up at any time; the worst case is that it does so up to one interval later.
 *
 * @param rejects Consecutive ignored releases from {@link updateReleaseRejects}
 * @param carState go-e car state as reported by the charger
 * @returns `true` while the release should not be sent this cycle
 */
export function holdRejectedRelease(rejects: number, carState: number): boolean {
	if (carState !== CAR_STATE_FINISHED || !Number.isFinite(rejects) || rejects < RELEASE_RETRY_LIMIT) {
		return false;
	}
	return (Math.trunc(rejects) - RELEASE_RETRY_LIMIT) % RELEASE_RETRY_INTERVAL !== 0;
}

/**
 * The status field a written command reads back from. `amx` is write-only on the charger and
 * always reports 0, while the current it set shows up in `amp` - comparing `amx` against itself
 * would never match and re-send the current every cycle.
 */
const COMMAND_READBACK: Record<ChargerCommand["parameter"], "alw" | "amp"> = { alw: "alw", amp: "amp", amx: "amp" };

/**
 * Drops the commands whose value the charger already reports, so an unchanged release or
 * current is not re-sent every cycle (each write wakes the charger's LEDs).
 *
 * The order of the remaining commands is preserved. A parameter whose readback field carries
 * no finite value is always sent.
 *
 * @param commands Ordered charger commands from {@link buildChargerCommands}
 * @param reported Values the charger reported in the last successful read
 * @returns The commands that change something on the charger
 */
export function dropUnchangedChargerCommands(commands: ChargerCommand[], reported: Partial<Record<ChargerCommand["parameter"], number>>): ChargerCommand[] {
	return commands.filter(command => reported[COMMAND_READBACK[command.parameter]] !== command.value);
}

/**
 * Builds a safe sequence of commands for the go-e Charger.
 *
 * When charging is enabled, the current is configured before the charge
 * release. Disabling only revokes the release and never sends an invalid
 * sub-minimum current.
 *
 * @param allow Whether charging should be enabled
 * @param ampere Requested charging current
 * @param firmware Charger firmware version
 * @returns Ordered charger commands, or `null` for an invalid request
 */
export function buildChargerCommands(allow: boolean, ampere: number, firmware: string): ChargerCommand[] | null {
	if (!allow) {
		return [{ parameter: "alw", value: 0 }];
	}
	if (!Number.isInteger(ampere) || ampere < MIN_CHARGE_CURRENT || ampere > MAX_CHARGE_CURRENT) {
		return null;
	}

	return [
		{ parameter: firmware === "033" ? "amp" : "amx", value: ampere },
		{ parameter: "alw", value: 1 },
	];
}

/** One wallbox competing for the shared installation current budget. */
export interface TotalCurrentParticipant {
	/**
	 * Current in amps the wallbox would draw this cycle before the budget cap is applied
	 * (its ChargeNOW current, or the ramped ChargeManager target). Use 0 when the wallbox is
	 * not charging this cycle, so it neither consumes budget nor is switched on by the cap.
	 */
	requestedAmp: number;
	/** Lowest current the wallbox may run at; a smaller remaining budget switches it off instead of throttling below this. */
	minAmp: number;
	/** ChargeNOW wallboxes are served before ChargeManager wallboxes, regardless of list order. */
	chargeNow: boolean;
}

/** Granted current for one wallbox after applying the installation current budget. */
export interface TotalCurrentAllocation {
	/** Whether the wallbox may charge after the budget cap */
	allow: boolean;
	/** Granted current in amps (0 when `allow` is false) */
	ampere: number;
}

/**
 * Caps the summed charging current of all wallboxes to a single installation-wide budget in
 * amperes, protecting the supply fuse. This is a hard limit applied on top of the PV surplus
 * allocation ({@link decideChargeManagerFleet}) and of ChargeNOW: watts are irrelevant here, a
 * 20 A feed carries 20 A whether a wallbox charges one- or three-phase.
 *
 * This is the conservative summed-ampere model (variant A): every ampere counts against one
 * budget regardless of which physical phase it lands on, because the charger does not reliably
 * report its phase rotation. It never exceeds the fuse rating; it can leave some capacity unused
 * when the load is spread across phases.
 *
 * ChargeNOW wallboxes are served first, then ChargeManager wallboxes in list (priority) order.
 * A wallbox that no longer fits is throttled to the remaining budget, or switched off when even
 * its minimum would not fit. ChargeNOW participants must be included with their requested current
 * even when no vehicle is connected yet: otherwise several idle ChargeNOW wallboxes could all be
 * plugged in at once and trip the fuse before the next cycle re-plans.
 *
 * @param participants Wallboxes competing for the budget, in configuration (priority) order
 * @param maxAmpTotal Installation current budget in amps; 0 or invalid disables the cap (pass-through)
 * @returns One allocation per participant, in the same order as the input
 */
export function limitTotalCurrent(participants: TotalCurrentParticipant[], maxAmpTotal: number): TotalCurrentAllocation[] {
	// no valid budget configured - every wallbox keeps exactly what it requested
	if (!Number.isFinite(maxAmpTotal) || maxAmpTotal <= 0) {
		return participants.map(p => ({ allow: p.requestedAmp > 0, ampere: p.requestedAmp > 0 ? p.requestedAmp : 0 }));
	}

	const budget = Math.floor(maxAmpTotal);
	const allocations: TotalCurrentAllocation[] = participants.map(() => ({ allow: false, ampere: 0 }));

	// ChargeNOW first, then ChargeManager, each group kept in its original (priority) order
	const order = participants.map((_, index) => index).sort((a, b) => Number(participants[b].chargeNow) - Number(participants[a].chargeNow));

	let used = 0;
	for (const index of order) {
		const participant = participants[index];
		if (participant.requestedAmp <= 0) {
			continue;
		}
		const min = Math.max(MIN_CHARGE_CURRENT, Math.floor(participant.minAmp));
		// a single wallbox can never draw more than the whole budget
		const want = Math.min(Math.floor(participant.requestedAmp), budget);
		const remaining = budget - used;

		if (want <= remaining) {
			allocations[index] = { allow: true, ampere: want };
			used += want;
		} else if (remaining >= min) {
			// not enough left for the full request, but enough to keep the wallbox charging throttled
			allocations[index] = { allow: true, ampere: remaining };
			used += remaining;
		}
		// else: even the minimum does not fit - leave the wallbox off and keep the budget for nobody
	}

	return allocations;
}

/** Amps the measured draw may fall below the commanded current before a wallbox counts as self-limiting. */
export const DEMAND_DEADBAND = 1;
/** Consecutive cycles a wallbox must draw clearly below its commanded current before its unused budget is reclaimed. */
export const RECLAIM_DELAY_CYCLES = 3;
/** Headroom in amps offered above the commanded/measured current so a wallbox can demonstrate rising demand. */
export const DEMAND_HEADROOM = 1;

/** Input for the measured-current demand of a single wallbox. */
export interface EffectiveDemandInput {
	/** Current the wallbox was allowed to draw last cycle (its applied SetAmp) */
	commandedAmp: number;
	/** Actually measured charging current this cycle (max phase current) */
	measuredAmp: number;
	/** Current the wallbox would take if unconstrained (ChargeNOW current or ramped ChargeManager target) */
	wishAmp: number;
	/** Lowest current the wallbox may run at */
	minAmp: number;
	/** Highest current the wallbox may run at */
	maxAmp: number;
	/** Consecutive cycles the wallbox has already drawn clearly below its commanded current */
	reclaimDelay: number;
}

/** Result of the measured-current demand calculation. */
export interface EffectiveDemandResult {
	/** Current to feed into the installation budget allocation for this wallbox */
	demand: number;
	/** Updated consecutive-cycle under-draw counter */
	reclaimDelay: number;
}

/**
 * Turns the raw commanded current into a measured-aware demand for the installation budget.
 *
 * The static budget reserves the commanded current even when the vehicle draws less (own lower
 * limit, tapering near full, temperature derating). This function follows the actual draw: a
 * wallbox that consumes everything it is given is offered one step more (so it can grow toward its
 * wish), while a wallbox that keeps drawing clearly less than allowed has its unused budget
 * reclaimed after a dwell time, freeing it for other wallboxes. A stable hold zone one deadband
 * wide between the grow and reclaim thresholds prevents flapping around the vehicle's real limit.
 *
 * Safety is unaffected: the demand never exceeds the wish or the maximum, and the caller only ever
 * lowers a wallbox's command to reclaim capacity, so the summed current can never exceed the fuse.
 *
 * @param input Last commanded current, measured draw, wish, limits and the dwell counter
 * @returns The budget demand for this wallbox and the updated dwell counter
 */
export function effectiveCurrentDemand(input: EffectiveDemandInput): EffectiveDemandResult {
	const { commandedAmp, measuredAmp, wishAmp, minAmp, maxAmp, reclaimDelay } = input;
	if (![commandedAmp, measuredAmp, wishAmp, minAmp, maxAmp, reclaimDelay].every(Number.isFinite)) {
		return { demand: Number.isFinite(wishAmp) ? Math.max(0, Math.floor(wishAmp)) : 0, reclaimDelay: 0 };
	}

	const wish = Math.max(0, Math.min(Math.floor(wishAmp), Math.floor(maxAmp)));
	const measured = Math.floor(measuredAmp);
	const commanded = Math.floor(commandedAmp);
	const floor = Math.max(MIN_CHARGE_CURRENT, Math.floor(minAmp));

	// not really charging yet (cold start, or vehicle connected but not drawing): reserve the wish, no reclaim
	if (measured < MIN_CHARGE_CURRENT) {
		return { demand: wish, reclaimDelay: 0 };
	}
	// drawing everything it is allowed - offer one step more so it can grow toward its wish
	if (measured >= commanded) {
		return { demand: Math.min(wish, commanded + DEMAND_HEADROOM), reclaimDelay: 0 };
	}
	// within the deadband just below the commanded current: satisfied and stable, hold and keep watching
	if (measured >= commanded - DEMAND_DEADBAND) {
		return { demand: Math.min(wish, commanded), reclaimDelay: 0 };
	}
	// clearly under-drawing - confirm it is sustained before releasing the unused budget
	const nextDelay = reclaimDelay + 1;
	if (nextDelay <= RECLAIM_DELAY_CYCLES) {
		return { demand: Math.min(wish, commanded), reclaimDelay: nextDelay };
	}
	// sustained under-draw: reserve only the measured draw plus headroom, freeing the rest for other wallboxes
	return { demand: Math.min(wish, Math.max(floor, measured + DEMAND_HEADROOM)), reclaimDelay: nextDelay };
}
