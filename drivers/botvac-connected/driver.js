"use strict";

const Robot = require('./robot');
const NeatoApi = Homey.app.neato;

module.exports = new class {

	constructor() {
		this.robots = {};
		this.init = this._init.bind(this);
		this.pair = this._pair.bind(this);
	}
	
	_init(devices, callback) {
		Homey.log('Devices:', devices);
		
		devices.forEach(this.initRobot.bind(this));
		Homey.manager('flow').on('action.start_cleaning', this.action_start_cleaning.bind(this));

		callback(null, true);
	}

	action_start_cleaning( callback, args ){
		Homey.log("Start cleaning", this.robots[args.device.id].name);
		
		this.robots[args.device.id].startCleaning((error, result) => {
			Homey.log("Cleaning start: ", error, result)
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
	
	
	
	initRobot(robot) {
		module.exports.setUnavailable( robot, "Robot not available at the moment" );
		module.exports.getSettings( robot, ( err, settings ) => {
			
			Homey.log('Initialising robot', robot.id, settings);
			this.robots[robot.id] = new Robot(settings.name, settings.serial, settings.secret_key);
			this.robots[robot.id].getState((error, robotStatus) => Homey.log(robotStatus));
			
			module.exports.setAvailable( robot );
			
		});
	}
}