"use strict";

const Robot = require('./robot');
const neato = Homey.app.neato;

module.exports = new class {

	constructor() {
		this.devices = {};
		this.robots = {};
		this.init = this._init.bind(this);
		this.pair = this._pair.bind(this);
	}
	
	_init(devices, callback) {
		this.devices = devices;
		
		Homey.log('Devices:', devices);
		
		// Do authorisation stuff when needed
		neato.on('authorized', (authorized) => {
			if(authorized)
			{
				Homey.log('Now init devices');
				this.initDevices();
			}
			else
			{
				Homey.log('Now remove devices');
				this.removeDevices();
			}
		});
		
		// Force once for startup :)
		neato.emit('authorized', neato.isAuthorised(true));
		

		Homey.manager('flow').on('action.start_house_cleaning', this.action_start_house_cleaning.bind(this));
		Homey.manager('flow').on('action.stop_house_cleaning', this.action_stop_house_cleaning.bind(this));
		Homey.manager('flow').on('action.pause_house_cleaning', this.action_pause_house_cleaning.bind(this));
		Homey.manager('flow').on('action.resume_house_cleaning', this.action_resume_house_cleaning.bind(this));
		Homey.manager('flow').on('action.send_to_base', this.action_send_to_base.bind(this));
		Homey.manager('flow').on('action.start_spot_cleaning', this.action_start_spot_cleaning.bind(this));
		this.added = this._device_added.bind(this);
		this.deleted = this._device_deleted.bind(this);
		// this.renamed = this._device_renamed.bind(this);
		// this.settings = this._device_settings.bind(this);
		
		callback(null, true);
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
		this.initRobot(robot);
	}
	
	_device_deleted(robot) {
		console.log('Removed device: ', robot);
		this.removeRobot(robot);
	}
	
	initDevices() {
		this.devices.forEach(this.initRobot.bind(this));
	}

	removeDevices() {
		this.devices.forEach(this.removeRobot.bind(this));
	}
	
	removeRobot(robot) {
		module.exports.setUnavailable( robot, "Robot not available at the moment" );
		
		if(this.robots[robot.id])
		{
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
				Homey.log(robotStatus)
				if(!error && robotStatus.meta.modelName == 'BotVacConnected')
				{
					module.exports.setAvailable( robot );
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
			});
			
		});
	}
}