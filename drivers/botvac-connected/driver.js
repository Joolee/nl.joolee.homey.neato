"use strict";

const Robot = require('./robot');
const neato = Homey.app.neato;

module.exports = new class {

	constructor() {
		this.devices = {};
		this.robots = {};
		this.init = this._init.bind(this);
		this.pair = this._pair.bind(this);
		this.capabilities = {
			measure_battery: {
				get: this.get_battery.bind(this)
			},
			vacuumcleaner_state: {
				get: this.get_state.bind(this),
				set: this.set_state.bind(this)
			}
		}	
	}
	
	get_state(robot, callback) {
		if(typeof(this.robots[robot.id]) != 'undefined' && typeof(this.robots[robot.id].oldStatus) == 'object')
		{
			var robotData = this.robots[robot.id].oldStatus;
			var state = 'stopped';
						
			// state == busy
			if(robotData.state == 2) {
				if(robotData.action = 1) {
					state = 'cleaning';
				}
				else if(robotData.action = 2) {
					state = 'spot_cleaning';
				}
			}		
			if(robotData.details.isDocked) {
				state = 'docked';
			}		
			if(robotData.details.isCharging) {
				state = 'charging';
			}		
			Homey.log('State requested by Homey: ', state);			
			callback(null, state);
		}
		else
		{
			Homey.log("Vacuum state requested but device not initialized yet");
			callback(null, false);
		}
	}
	
	set_state(robot, command, callback) {
		if(typeof(this.robots[robot.id]) != 'undefined' && typeof(this.robots[robot.id].oldStatus) == 'object')
		{
			Homey.log('Set vacuum state to', command);
			if(command == 'cleaning') {
				this.action_start_house_cleaning(callback, {device: robot});
			}		
			else if(command == 'spot_cleaning') {
				this.action_start_spot_cleaning(callback, {device: robot});
			}		
			else if(command == 'stopped') {
				this.action_pause_house_cleaning(callback, {device: robot});
			}		
			else {
				// 'docked' and 'charging' and simply a safe default :)
				this.action_send_to_base(callback, {device: robot});
			}			
		}		
		else
		{
			Homey.log("Vacuum state set but device not initialized yet");
			callback(null, false);
		}		
	}
	
	get_battery(robot, callback) {
		if(typeof(this.robots[robot.id]) != 'undefined' && typeof(this.robots[robot.id].oldStatus) == 'object')
		{
			var charge = this.robots[robot.id].oldStatus.details.charge;
			Homey.log("Battery charge requested", charge);
			callback(null, charge);
		}		
		else
		{
			Homey.log("Battery charge requested but device not initialized yet");
			callback(null, false);
		}		
	}
	
	_init(devices, callback) {
		this.devices = devices;

		Homey.log('Devices:', devices);
		
		// Do authorisation stuff when needed
		neato.on('authorized', (authorized) => {
			if(authorized)
			{
				if(Object.keys(this.robots).length == 0 && this.devices.length > 0)
				{
					this.initDevices();
				}
				else
				{
					Homey.log('No devices to initialize');
				}
			}			
			else
			{
				Homey.log('Now remove devices');
				this.removeDevices();
			}			
		});
		
		// Force once for startup :)
		neato.emit('authorized', neato.isAuthorised(true));
		
		// Action flows
		Homey.manager('flow').on('action.start_house_cleaning', this.action_start_house_cleaning.bind(this));
		Homey.manager('flow').on('action.stop_house_cleaning', this.action_stop_house_cleaning.bind(this));
		Homey.manager('flow').on('action.pause_house_cleaning', this.action_pause_house_cleaning.bind(this));
		Homey.manager('flow').on('action.resume_house_cleaning', this.action_resume_house_cleaning.bind(this));
		Homey.manager('flow').on('action.send_to_base', this.action_send_to_base.bind(this));
		Homey.manager('flow').on('action.start_spot_cleaning', this.action_start_spot_cleaning.bind(this));
		
		// Condition flows		
		Homey.manager('flow').on('condition.cleaning', this.condition_cleaning.bind(this));

		this.added = this._device_added.bind(this);
		this.deleted = this._device_deleted.bind(this);
		// this.renamed = this._device_renamed.bind(this);
		this.settings = this._device_settings.bind(this);
		callback(null, true);
	}
	
	condition_cleaning( callback, args ){
		Homey.log("Condition card! Current state", '\'' + this.robots[args.device.id].oldStatus.state + '\'');
		callback( null, (this.robots[args.device.id].oldStatus.state == 2) );
	}

	action_start_house_cleaning( callback, args ){
		Homey.log("Start house cleaning", this.robots[args.device.id].name);
		
		this.robots[args.device.id].startCleaning(args.cleaning_mode == 'true', (error, result) => {
			Homey.log("Start cleaning: ", error, result)
			callback( null, error );
		});
	}
	
	action_stop_house_cleaning( callback, args ){
		Homey.log("Stop cleaning", this.robots[args.device.id].name);
		
		this.robots[args.device.id].stopCleaning((error, result) => {
			Homey.log("Stop cleaning: ", error, result)
			callback( null, error );
		});
	}
	
	action_pause_house_cleaning( callback, args ){
		Homey.log("Pause cleaning", this.robots[args.device.id].name);
		
		this.robots[args.device.id].pauseCleaning((error, result) => {
			Homey.log("Pause stop: ", error, result)
			callback( null, error );
		});
	}
	
	action_resume_house_cleaning( callback, args ){
		Homey.log("Resume cleaning", this.robots[args.device.id].name);
		
		this.robots[args.device.id].resumeCleaning((error, result) => {
			Homey.log("Resume cleaning: ", error, result)
			callback( null, error );
		});
	}
	
	action_send_to_base( callback, args ){
		Homey.log("Send to base", this.robots[args.device.id].name);
		
		this.robots[args.device.id].sendToBase((error, result) => {
			Homey.log("Send to base: ", error, result)
			callback( null, error );
		});
	}

	action_start_spot_cleaning( callback, args ){
		Homey.log("Start spot cleaning", this.robots[args.device.id].name);
		
		this.robots[args.device.id].startSpotCleaning(args.cleaning_mode == 'true', args.spot_width, args.spot_height, args.cleaning_frequency == 'true', (error, result) => {
			Homey.log(args);
			Homey.log("Start spot cleaning: ", error, result)
			callback( null, error );
		});
	}
	
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
			Homey.log('List devices started');
			// list_devices event is triggered multiple times when you leave the page open
			var foundDevices = [];

			Homey.app.neato.getRobots()
			.then((robots) => {
				robots.forEach((robot) => {
					Homey.log('Found robot:', robot);
					if(robot.model == 'BotVacConnected')
					{
						Homey.log('It\'s a Botvac connected!');
						foundDevices.push({
							name: robot.name,
							data: {
								id: robot.serial,
							},
							settings: robot
						});
					}
					
					else
					{
						Homey.log('Model is not supported by this driver');
					}
					
				});
			
				Homey.log('Found devices: ', foundDevices);
				
				callback(null, foundDevices);
			});
		});
	}

	_device_added(robot, callback) {
		console.log('Added device: ', robot);
		this.devices.push(robot);
		this.initRobot(robot);
	}
	
	_device_deleted(robot) {
		console.log('Removed device: ', robot);
		this.removeRobot(robot);
		this.devices.splice(this.devices.indexOf(robot), 1);
		Homey.log('Devices left:', this.devices);
	}
	
    _device_settings(robot, newSettingsObj, oldSettingsObj, changedKeysArr, callback) {
        // Don't do difficult stuff. Just re-create the robot
        console.log('Settings changed. Reinitialising device.', changedKeysArr);
        callback( null, true );
        this.initRobot(robot);
    }
	
	initDevices() {
		Homey.log('Initialize devices');
		this.devices.forEach(this.initRobot.bind(this));
	}

	removeDevices() {
		Homey.log('Remove devices');
		this.devices.forEach(this.removeRobot.bind(this));
	}
	
	removeRobot(robot) {
		module.exports.setUnavailable( robot, "Robot not available at the moment" );
		
		if(this.robots[robot.id])
		{
			clearInterval(this.robots[robot.id].refreshInterval);
			Homey.log('Removing robot', robot);
			delete this.robots[robot.id];
		}
	}
	
	initRobot(robot) {
		// Start clean
		this.removeRobot(robot);
		
		module.exports.getSettings( robot, ( err, settings ) => {
			Homey.log('Initialising robot', robot.id, settings);
			
			this.robots[robot.id] = new Robot(settings.name, settings.serial, settings.secret_key);
			
			// Get robot state on initialise
			this.robots[robot.id].getState((error, robotStatus) => {
				if(!error && robotStatus.meta.modelName == 'BotVacConnected')
				{
					this.robots[robot.id].oldStatus = robotStatus;
					module.exports.setAvailable( robot );
					
					this.robots[robot.id].refreshInterval = setInterval(() => {
						Homey.log('Checking state changes of robot \'' + this.robots[robot.id].name + '\'');

						this.robots[robot.id].getState((error, robotStatus) => {
							if(this.robots[robot.id]) {
								this.robotStatusUpdate(robot, this.robots[robot.id].oldStatus, robotStatus);
								this.robots[robot.id].oldStatus = robotStatus;
							}
						})
					}, settings.polling_interval * 1000 + Math.floor(Math.random() * 10));
					
					this.robotStatusUpdate(robot, null, robotStatus);
				}
				
				else if(error)
				{
					Homey.log('Cannot set robot available because', error);
					this.removeRobot(robot);
					module.exports.setUnavailable( robot, error );
				}
				
				else
				{
					Homey.log('Cannot set robot available because model is unknown: ', robotStatus.meta.modelName);
					this.removeRobot(robot);
					module.exports.setUnavailable( robot, 'Model ' + robotStatus.meta.modelName + ' is unknown' );
				}
				
				// Something failed
				if(!this.robots[robot.id])
				{
					// Retry later
					setTimeout(this.initRobot.bind(this, robot), settings.polling_interval * 1000);
				}
				
			});
		});
	}
	
	// Commence Triggers
	
	robotStateChanged(robot, oldStatus, newStatus) {
		Homey.log('Robot status changed', robot, newStatus);
	
		if(oldStatus != null && newStatus.state != oldStatus.state)
		{
			var stateTriggers = ['state_stops_cleaning', 'state_starts_cleaning', 'state_paused', 'state_error'];
			this.triggerDevice( stateTriggers[newStatus.state - 1], null, null, robot);
		}
		
	}
	
	robotDockingChanged(robot, isDocked) {
		Homey.log('Dock status changed', robot, isDocked);
		
		if(isDocked)
		{
			this.triggerDevice( 'enters_dock', null, null, robot);
			
		}
		
		if(!isDocked)
		{
			this.triggerDevice( 'leaves_dock', null, null, robot);
		}
		
	}
	
	notifyHomeyOfUpdatedState(robot) {
    	this.get_state(robot, (err, state) => {
        	module.exports.realtime(robot, 'vacuumcleaner_state', state);
        });
	}
	
    robotStatusUpdate(robot, oldStatus, newStatus) {
        Homey.log("Robot status changed", robot, oldStatus, newStatus);
        
        if(oldStatus == null || oldStatus.state != newStatus.state || oldStatus.action != newStatus.action)
        {
            this.robotStateChanged(robot, oldStatus, newStatus);
            this.notifyHomeyOfUpdatedState(robot);
        }
        
        if(oldStatus != null && oldStatus.details.isDocked != newStatus.details.isDocked)
        {
            this.robotDockingChanged(robot, newStatus.details.isDocked);
            this.notifyHomeyOfUpdatedState(robot);
        }
    }
	
	triggerDevice(eventName, tokens, state, device_data, callback) {
		console.log('Triggering flow card \'' + eventName + '\' for robot ' + device_data.id);
		if(typeof callback !== 'function')
		{
			callback = (err, result) => {
				if( err ) return Homey.error(err);
			}
		}
		
		Homey.manager('flow').triggerDevice(eventName, tokens, state, device_data, callback);
	}   
	
}