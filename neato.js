'use strict';
var http = require('http.min');

module.exports = class Neato {

	constructor() {
		Homey.log("Neato API initialised");
		this.config = Homey.app.config.api;
		this.oauthurl = "https://" + this.config.oauthHost + "/oauth2/authorize?client_id=" + this.config.id +
		  "&scope=control_robots+public_profile&response_type=code&redirect_uri=" + this.config.callback;
		
		this.authorized = false;
		this.isAuthorised();
	}
	
	// Handle Homey integration to oAuth
	authorize(callback) {
		Homey.log("Requested OAuth2 authorisation url");
		
		return new Promise((resolve, reject) => {
			Homey.manager('cloud').generateOAuth2Callback(
				this.oauthurl,
				// Return a Homey OAuth2 url to client
				(err, result) => {
					callback(err, {url: result});
				},
				// This is called when authorisation has been granted or denied by the user
				(err, code) => {
					Homey.log("Received code, swapping for token now", code);

					var failed = (error) => {
						reject(error);
						Homey.log("Neato->authorize->Failure!", error);
					}
					
					this.getToken.call(this, code)
						.then((auth_data) => {
							if(auth_data.error) {
								failed(auth_data.error + ': ' + auth_data.error_description);
							}
							else
							{
								Homey.log("Neato->authorize->Success!", auth_data);
								
								this.isAuthorised.call(this)
									.then((user) => {
										resolve(user);
									})
									.catch(failed);
							}
						})
						.catch(failed);
				}
			);
		});
	}
	
	// Doesn't seem to work but still try
	// Even their own online demo doesn't revoke app access...
	deauthorize(callback) {
		Homey.log("Revoke token");
		var token = Homey.manager('settings').get('accessToken');
		http.post(
			{
				protocol: 'https:',
				hostname: this.config.beehive,
				path: '/oauth2/revoke',
				headers: {
					"accept": "application/vnd.neato.beehive.v1+json",
					"Authorization": "Bearer " + token,
				},
				json: true
			},
			{
			  'token': token
			}
		)
			.then((response) => {
				Homey.log("Token revoked")
			})
			.catch((error) => {
				Homey.log("Something went wrong while revoking token", error)
			});
		
		this.authorized = false;
		Homey.manager('settings').set('authorized', false);
		Homey.manager('settings').set('user', null);
		Homey.manager('settings').set('accessToken', null);
		Homey.manager('api').realtime('authorized', false);
		callback(null, true);
	}
	
	getToken(code) {
		return new Promise((resolve, reject) => {
			http.post(
				{
					protocol: 'https:',
					hostname: this.config.beehive,
					path: '/oauth2/token',
					json: true
				},
				{
				  'client_id': this.config.id,
				  'client_secret': this.config.secret,
				  'code': code,
				  'redirect_uri': this.config.callback,
				  'grant_type': 'authorization_code'
				}
			)
				.then((response) => {
					Homey.manager('settings').set('accessToken', response.data.access_token);
					resolve(response.data)
				})
				.catch((error) => {
					Homey.manager('settings').set('accessToken', null);
					reject(error)
				});
		});
	}
	
	isAuthorised() {
		return new Promise((resolve, reject) => {
			
			var failed = (message) => {
				this.authorized = false;
				Homey.manager('settings').set('authorized', false);
				Homey.manager('settings').set('user', null);
				
				Homey.log("Not authorised: ", message);
				reject("Not authorised: " + message)
			}
			
			// This might prove troubling when somebody revokes the token
			// if(this.authorized)
			// {
				// resolve(Homey.manager('settings').get('user'))
			// }
			if(typeof(Homey.manager('settings').get('accessToken')) == 'undefined')
			{
				failed("No token stored");
			}
			else
			{
				var token = Homey.manager('settings').get('accessToken');
				Homey.log('Using token', token);
				http.get(
					{
						protocol: 'https:',
						hostname: this.config.beehive,
						path: "/users/me",
						headers: {
							"accept": "application/vnd.neato.beehive.v1+json",
							"Authorization": "Bearer " + token,
						},
						json: true
					}
				)
					.then((response) => {
						if(response.response.statusCode == '200')
						{
							this.authorized = true;
							Homey.manager('settings').set('authorized', true);
							Homey.manager('settings').set('user', response.data);
							Homey.log("Authorised", response.data);
							resolve(response.data)
						}
						else
						{
							failed(response.data.message);
						}
					})
					.catch(failed);
			}
			
		});
		Homey.log("Checked authorisation");
	}
	
	getRobots() {
		Homey.log('Finding robot buddies');
		return new Promise((resolve, reject) => {
			this.isAuthorised.call(this)
				.catch(failed);
			
			var failed = (message) => {
				Homey.log("Couldn't fetch robots: ", message);
				reject("Couldn't fetch robots: " + message)
			}

			var token = Homey.manager('settings').get('accessToken');
			http.get(
				{
					protocol: 'https:',
					hostname: this.config.beehive,
					path: "/users/me/robots",
					headers: {
						"accept": "application/vnd.neato.beehive.v1+json",
						"Authorization": "Bearer " + token,
					},
					json: true
				}
			)
				.then((response) => {
					if(response.response.statusCode == '200')
					{
						resolve(response.data)
					}
					else
					{
						Homey.log('I\'m bad at finding friends :(', response);
						failed(response.data.message);
					}
				})
				.catch(failed);
		});
	}
}