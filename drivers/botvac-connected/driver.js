"use strict";

const Robot = require('./robot');
const neato = Homey.app.neato;

module.exports = new class {

	constructor() {
		// Define some internal variables
		this.devices = {};
		this.robots = {};
		this.commandTimeout = {};

		// Map Homey interface functions (functions it expects to be in module.exports.XXX)
		this.init = this._init.bind(this);
		this.pair = this._pair.bind(this);
		this.added = this._device_added.bind(this);
		this.deleted = this._device_deleted.bind(this);
		// this.renamed = this._device_renamed.bind(this);
		this.settings = this._device_settings.bind(this);

		this.capabilities = {
			measure_battery: {
				get: this.ignore_capability_get.bind(this)
			},
			vacuumcleaner_state: {
				get: this.ignore_capability_get.bind(this),
				set: this.set_state.bind(this)
			}
		}
	}

	// Interface to Homey functions

	// AKA module.exports.init
	_init(devices, callback) {
		// Store the list of devices Homey gives us
		this.devices = devices;

		Homey.log('Devices:', devices);

		// Do authorisation stuff when needed
		neato.on('authorized', (authorized) => {
			if (authorized) {
				if (Object.keys(this.robots).length == 0) {
					this.initDevices();
				} else {
					Homey.log('Devices already initialised');
				}
			} else {
				this.deInitDevices();
			}
		});

		// Map flow functions
		
		// Action flows
		Homey.manager('flow').on('action.start_house_cleaning', this.action_start_house_cleaning.bind(this));
		Homey.manager('flow').on('action.stop_cleaning', this.action_stop_cleaning.bind(this));
		Homey.manager('flow').on('action.pause_cleaning', this.action_pause_cleaning.bind(this));
		Homey.manager('flow').on('action.resume_cleaning', this.action_resume_cleaning.bind(this));
		Homey.manager('flow').on('action.send_to_base', this.action_send_to_base.bind(this));
		Homey.manager('flow').on('action.start_spot_cleaning', this.action_start_spot_cleaning.bind(this));

		// Condition flows		
		Homey.manager('flow').on('condition.busy', this.condition_busy.bind(this));
		Homey.manager('flow').on('condition.docked', this.condition_docked.bind(this));
		Homey.manager('flow').on('condition.charging', this.condition_charging.bind(this));
		Homey.manager('flow').on('condition.paused', this.condition_paused.bind(this));
		Homey.manager('flow').on('condition.stopped', this.condition_stopped.bind(this));

		// Ready to rock!
		callback(null, true);
	}

	// AKA module.exports.pair
	_pair(socket) {
		socket.on('authorized', (data, callback) => {
			Homey.app.neato.isAuthorised()
				.then(() => callback(null, true))
				.catch(() => callback(null, false));
		});

		socket.on('authorize', (data, callback) => {
			Homey.app.neato.authorize(callback)
				.then((user) => {
					socket.emit('authorized', true, null);
				});
		});

		socket.on('list_devices', (data, callback) => {
			Homey.log('[Info] List devices started');
			// list_devices event is triggered multiple times when you leave the page open
			var foundDevices = [];

			Homey.app.neato.getRobots()
				.then((robots) => {
					robots.forEach((robot) => {
						Homey.log('Found robot:', robot);
						if (robot.model == 'BotVacConnected') {
							Homey.log('It\'s a Botvac connected!');
							foundDevices.push({
								name: robot.name,
								data: {
									id: robot.serial,
								},
								settings: robot
							});
						} else {
							Homey.log('[Error] Model is not supported by this driver');
						}

					});

					Homey.log('[Info] Found devices: ', foundDevices);

					callback(null, foundDevices);
				});
		});
	}

	// AKA module.exports.added
	_device_added(robot, callback) {
		console.log('[Info] Added device: ', robot);
		this.devices.push(robot);
		this.initRobot(robot);
	}

	// AKA module.exports.deleted
	_device_deleted(robot) {
		console.log('[Info] Removed device: ', robot);
		this.deInitRobot(robot);
		this.devices.splice(this.devices.indexOf(robot), 1);
		Homey.log('[Info] Devices left:', this.devices);
	}

	// AKA module.exports.settings
	_device_settings(robot, newSettingsObj, oldSettingsObj, changedKeysArr, callback) {
		// Don't do difficult stuff. Just re-create the robot
		console.log('[Info] Settings changed. Reinitialising device.', changedKeysArr);
		callback(null, true);
		this.initRobot(robot);
	}

	// End Interface to Homey functions /

	// Robot management functions

	initDevices() {
		if (Object.keys(this.devices).length > 0) {
			Homey.log('[Info] Initilise devices');
			this.devices.forEach(this.initRobot.bind(this));
		} else {
			Homey.log('[Error] No devices to initialise');
		}
	}

	deInitDevices() {
		if (Object.keys(this.devices).length > 0 && Object.keys(this.robots).length) {
			Homey.log('[Info] De-initialise all devices');
			this.devices.forEach(this.deInitRobot.bind(this));
		} else {
			Homey.log('[Error] No devices to de-initialise');
		}
	}

	deInitRobot(robot) {
		module.exports.setUnavailable(robot, "Robot not available at the moment");

		if (this.robots[robot.id]) {
			clearInterval(this.robots[robot.id].refreshInterval);
			Homey.log('[Info] Removing robot:', robot);
			delete this.robots[robot.id];
		}
	}

	initRobot(robot) {
		// Start clean
		this.deInitRobot(robot);

		module.exports.getSettings(robot, (err, settings) => {
			Homey.log('[Info] Initialising robot', settings.name + ', current settings:');
			Homey.log(settings);

			this.robots[robot.id] = new Robot(settings.name, settings.serial, settings.secret_key);

			// Get robot state on initialise
			this.robots[robot.id].getState((error, robotStatus) => {
				if (!error && robotStatus.meta.modelName == 'BotVacConnected') {
					module.exports.setAvailable(robot);

					// Set up polling at regular intervals (randomize within 100ms to prevent all robots to poll at the same time)
					this.robots[robot.id].refreshInterval = setInterval(this.pollStatus.bind(this, robot),
						settings.polling_interval * 1000 + Math.floor(Math.random() * 100));

					this.robotStatusUpdate(robot, null, robotStatus);
					this.robots[robot.id].cachedStatus = robotStatus;
				} else if (error) {
					Homey.log("[Error] Encountered an error when fetching the robot's initial status. Retrying in " + settings.polling_interval + " seconds. Error:\n\r", error);
					this.deInitRobot(robot);
					// Retry later
					setTimeout(this.initRobot.bind(this, robot), settings.polling_interval * 1000);
					module.exports.setUnavailable(robot, error);
				} else {
					Homey.log('[Error] Cannot set robot available because model is unknown:', robotStatus.meta.modelName);
					this.deInitRobot(robot);
					module.exports.setUnavailable(robot, 'Model ' + robotStatus.meta.modelName + ' is unknown');
				}

			});
		});
	}

	pollStatus(robot) {
		Homey.log('[Polling] Neato server for updates for robot: ' + this.robots[robot.id].name);

		this.robots[robot.id].getState((error, robotStatus) => {
			if (this.robots[robot.id]) {
				this.robotStatusUpdate(robot, this.robots[robot.id].cachedStatus, robotStatus);
				this.robots[robot.id].cachedStatus = robotStatus;
			}
		})
	}

	// End robot management functions /

	// Device card (capability) functions
	ignore_capability_get(robot, callback) {
		// Apparently, since version 1.0, capability GET functions are only called when the app has just been initialised.
		// We don't have the robot status at this moment so always return false
		// The device card is updated later with module.exports.realtime functions
		Homey.log("[Info] Ignoring capability 'get' function. This should only happen when the application or device is just initialised!");
		callback(null, false);
	}

	// Somebody changed the 'state' field in the device card 
	set_state(robot, command, callback) {
		if (typeof(this.robots[robot.id]) != 'undefined' && typeof(this.robots[robot.id].cachedStatus) == 'object') {

			var previousStatus = this._parse_state(this.robots[robot.id].cachedStatus);

			Homey.log('[Info] (Picker) Set vacuum state to', command);

			// Cancel command waiting to be executed if there is one
			clearTimeout(this.commandTimeout[robot.id]);

			// Set timeout for command to execute in 5 second
			this.commandTimeout[robot.id] = setTimeout(() => {
				if (command == 'cleaning') {
					this.action_start_house_cleaning((error, result) => {
						// Homey.log("Robot send house claning result:", error, result)
						if (error) {
							Homey.log('[Error] (Picker) Start house cleaning: failed, reverting to previous state!')
							module.exports.realtime(robot, 'vacuumcleaner_state', previousStatus);
						}
					}, {
						device: robot,
						cleaning_mode: 'false' // Default to turbo mode
					});
				} else if (command == 'spot_cleaning') {
					this.action_start_spot_cleaning((error, result) => {
						// Homey.log("Robot send spot cleaning result:", error, result)
						if (error) {
							Homey.log('[Error] (Picker) Start spot cleaning: failed, reverting to previous state!')
							module.exports.realtime(robot, 'vacuumcleaner_state', previousStatus);
						}
					}, {
						device: robot,
						cleaning_mode: 'false', // Default to turbo mode
						spot_width: 100, // Default to 100
						spot_height: 100, // Default to 100
						cleaning_frequency: 'true' // Default to 2 passes
					});
				} else if (command == 'stopped') {
					this.action_pause_cleaning((error, result) => {
						// Homey.log("Robot send pause result:", error, result)
						if (error) {
							Homey.log('[Error] (Picker) Pause cleaning: failed, reverting to previous state!')
							module.exports.realtime(robot, 'vacuumcleaner_state', previousStatus);
						}
					}, {
						device: robot
					});
				} else {
					// 'docked' and 'charging' and simply a safe default :)

					this.action_send_to_base((error, result) => {
						// Homey.log("Robot send to base result:", error, result)
						if (error) {
							Homey.log('[Error] (Picker) Send to base: failed, reverting to previous state!')
							module.exports.realtime(robot, 'vacuumcleaner_state', previousStatus);
						}
					}, {
						device: robot
					});
				}
			}, 5000);

			// Confirm to Homey that we set the command
			callback(null, command);
		} else {
			Homey.log("[Error] (Picker) Vacuum state set but device not initialised yet");
			callback(null, false);
		}
	}

	// End device card (capability) functions /


	// Trigger card functions:

	// This function is run every time the Neato servers have been polled
	robotStatusUpdate(robot, cachedStatus, freshStatus) {
		Homey.log("[Success] Updated data from Neato server for robot: " + this.robots[robot.id].name);
		// Homey.log("Cached status:");
		// Homey.log(cachedStatus);
		// Homey.log("Fresh status:");
		// Homey.log(freshStatus);

		// Run on state change of state: stopped / cleaning / spot cleaning / docked / charging (to update device card and run state trigger cards)
		if (cachedStatus == null || cachedStatus.state != freshStatus.state || cachedStatus.details.isCharging != freshStatus.details.isCharging || cachedStatus.details.isDocked != freshStatus.details.isDocked) {
			this.robotUpdateDeviceCard(robot, cachedStatus, freshStatus);
		}

		// Run on change of docked status (run trigger cards)
		if (cachedStatus == null || cachedStatus.details.isDocked != freshStatus.details.isDocked) {
			this.robotDockedChanged(robot, cachedStatus, freshStatus);
		}
		
		// Run on change of charge status (run trigger cards)
		if (cachedStatus == null || cachedStatus.details.isDocked != freshStatus.details.isDocked) {
			this.robotDockedChanged(robot, cachedStatus, freshStatus);
		}

		// Run on change of battery level (update device card)
		if (cachedStatus == null || cachedStatus.details.charge != freshStatus.details.charge) {
			this.robotBatteryLevelChanged(robot, cachedStatus, freshStatus);
		}
	}

	// Helper function to convert the Neato status object to something Homey will understand (stopped, cleaning, spot_cleaning, docked or charging)
	_parse_state(robotData) {
	
		Homey.log('[Info] Robot state helper function running...');
		Homey.log('[Info] Analysing new robot data:');
		Homey.log(robotData);
		
		// device card default state == stopped
		var state = 'stopped';

		if (robotData.state == 2) {
			// device card state == cleaning
			if (robotData.action == 1) {
				state = 'cleaning';
			// device card state == spot cleaning
			} else if (robotData.action == 2) {
				state = 'spot_cleaning';
			}
		}
		
		// device card state == docked
		if (robotData.details.isDocked) {
			state = 'docked';
		}
		
		// device card state == charging
		if (robotData.details.isCharging) {
			state = 'charging';
		}

		Homey.log('[Info] Robot state helper function detected state: ' + state)
		return state;
	}

	robotUpdateDeviceCard(robot, cachedStatus, freshStatus) {
		var parsedState = this._parse_state(freshStatus);
		Homey.log('[Info] Robot state status changed to: ' + parsedState + ' for robot ' + this.robots[robot.id].name);

		// Fire corresponding trigger card but not when the app has just initialised
		if (cachedStatus !== null) {
			var stateTriggers = ['state_stops_cleaning', 'state_starts_cleaning', 'state_paused', 'state_error'];
			this._triggerDevice(stateTriggers[freshStatus.state - 1], null, null, robot);
		}

		// Notify Homey for device card update
		// Also do this when the app has just been initialised
		module.exports.realtime(robot, 'vacuumcleaner_state', parsedState);
	}

	robotDockedChanged(robot, cachedStatus, freshStatus) {
		var parsedState = this._parse_state(freshStatus);
		Homey.log('[Info] Docking status changed to: ' + freshStatus.details.isDocked + ' for robot ' + this.robots[robot.id].name);

		// Do not fire triggers when the app has just been initialised
		if (cachedStatus !== null) {
			if (freshStatus.details.isDocked) {
				this._triggerDevice('enters_dock', null, null, robot);

			} else {
				this._triggerDevice('leaves_dock', null, null, robot);
			}
		}

	}

	robotBatteryLevelChanged(robot, cachedStatus, freshStatus) {
		Homey.log('[Info] Charge status changed to: ' + freshStatus.details.charge + ' for robot ' + this.robots[robot.id].name);

		// Always inform Homey of a charge change, also when the device has just been initialised
		module.exports.realtime(robot, 'measure_battery', freshStatus.details.charge);
	}

	// End trigger card functions /

	// Condition card function

	condition_busy(callback, args) {
		var robot = this.robots[args.device.id];

		if (robot.cachedStatus.state == 2)
			var busy_boolean = true
		else
			var busy_boolean = false

		Homey.log("[Condition flow card] 'is busy': current state for robot " + robot.name + " is '" + busy_boolean + "'");
		// Return true when state equals 2
		callback(null, (robot.cachedStatus.state == 2));
	}

	condition_docked(callback, args) {
		var robot = this.robots[args.device.id];

		Homey.log("[Condition flow card] 'is docked': current state for robot " + robot.name + " is '" + robot.cachedStatus.details.isDocked + "'");
		// Return true when state is docked
		callback(null, (robot.cachedStatus.details.isDocked));
	}

	condition_charging(callback, args) {
		var robot = this.robots[args.device.id];

		Homey.log("[Condition flow card] 'is charging': current state for robot " + robot.name + " is '" + robot.cachedStatus.details.isCharging + "'");
		// Return true when state is charging
		callback(null, (robot.cachedStatus.details.isCharging));
	}
	
	condition_paused(callback, args) {
		var robot = this.robots[args.device.id];
		
		if (robot.cachedStatus.state == 3)
			var paused_boolean = true
		else
			var paused_boolean = false

		Homey.log("[Condition flow card] 'is paused': current state for robot " + robot.name + " is '" + paused_boolean + "'");
		// Return true when state is charging
		callback(null, (robot.cachedStatus.state == 3));
	}
	
	condition_stopped(callback, args) {
		var robot = this.robots[args.device.id];
		
		if (robot.cachedStatus.state == 1)
			var stopped_boolean = true
		else
			var stopped_boolean = false

		Homey.log("[Condition flow card] 'is stopped': current state for robot " + robot.name + " is '" + stopped_boolean + "'");
		// Return true when state is charging
		callback(null, (robot.cachedStatus.state == 1));
	}

	// End condition card function /

	// Action card functions

	action_start_house_cleaning(callback, args) {
		var robot = this.robots[args.device.id];
		Homey.log("[Info] Attempting to start house cleaning:", robot.name);

		robot.startCleaning(args.cleaning_mode == 'true', (error, result) => {
			// Homey.log(error, result)
			if (error) {
				Homey.log("[Error] Attempting to start house cleaning:", error)
			}
			else {
				Homey.log("[Success] Attempting to start house cleaning:", result)
			}
			callback(error, result)
		});
	}

	action_stop_cleaning(callback, args) {
		var robot = this.robots[args.device.id];
		Homey.log("[Info] Attempting to stop cleaning:", robot.name);

		robot.stopCleaning((error, result) => {
			// Homey.log(error, result)
			if (error) {
				Homey.log("[Error] Attempting to stop cleaning:", error)
			}
			else {
				Homey.log("[Success] Attempting to stop cleaning:", result)
			}
			callback(error, result)
		});
	}

	action_pause_cleaning(callback, args) {
		var robot = this.robots[args.device.id];
		Homey.log("[Info] Attempting to pause cleaning:", robot.name);

		robot.pauseCleaning((error, result) => {
			// Homey.log(error, result)
			if (error) {
				Homey.log("[Error] Attempting to pause cleaning:", error)
			}
			else {
				Homey.log("[Success] Attempting to pause cleaning:", result)
			}
			callback(error, result)
		});
	}

	action_resume_cleaning(callback, args) {
		var robot = this.robots[args.device.id];
		Homey.log("[Info] Attempting to resume cleaning:", robot.name);

		robot.resumeCleaning((error, result) => {
			// Homey.log(error, result)
			if (error) {
				Homey.log("[Error] Attempting to resume cleaning:", error)
			}
			else {
				Homey.log("[Success] Attempting to resume cleaning:", result)
			}
			callback(error, result)
		});
	}

	action_send_to_base(callback, args) {
		var robot = this.robots[args.device.id];
		Homey.log("[Info] Attempting to send to base:", robot.name);

		this.robots[args.device.id].sendToBase((error, result) => {
			// Homey.log(error, result)
			if (error) {
				Homey.log("[Error] Send to base:", error)
			}
			else {
				Homey.log("[Success] Send to base:", result)
			}
			callback(error, result)
		});
	}

	action_start_spot_cleaning(callback, args) {
		var robot = this.robots[args.device.id];
		Homey.log("[Info] Attempting to start spot cleaning:", robot.name, args);

		robot.startSpotCleaning(args.cleaning_mode == 'true', args.spot_width, args.spot_height, args.cleaning_frequency == 'true', (error, result) => {
			// Homey.log(error, result)
			if (error) {
				Homey.log("[Error] Attempting to start spot cleaning:", error)
			}
			else {
				Homey.log("[Success] Attempting to start spot cleaning:", result)
			}
			callback(error, result)
		});
	}

	// End action card functions



	// Trigger card helper function to add some debug information
	_triggerDevice(eventName, tokens, state, device_data, callback) {
		console.log('[Trigger Flow card] \'' + eventName + '\' for robot ' + device_data.id);
		if (typeof callback !== 'function') {
			callback = (err, result) => {
				if (err) return Homey.error(err);
			}
		}

		Homey.manager('flow').triggerDevice(eventName, tokens, state, device_data, callback);
	}
}