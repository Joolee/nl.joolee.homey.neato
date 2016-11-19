"use strict";

const NeatoApi = require("./neato");

module.exports = new class {
	constructor() {
		this.config = {
			api: {
				beehive: "beehive.neatocloud.com",
				oauthHost: "apps.neatorobotics.com",
				callback: "https://callback.athom.com/oauth2/callback/"
			}
		}
		
		// Todo: Get from secure environment
		this.config.api.id = 'da618466d4116a3b2afc11385b89a375bbc416c752c0a3791ac9a54bf55a715f';
		this.config.api.secret = '64513ff4ce9cd039c7f016e31d701a88b29646141c1ab2fb82e51daef0fb09ab';
		Homey.log("App constructed");
		
		this.init = this._init.bind(this);
	}
	
	_init() {
		Homey.log("App Initialised");
		Homey.log(this.config);
		
		this.neato = new NeatoApi();
	}
}