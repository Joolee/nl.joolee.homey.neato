'use strict';
var http = require('http.min');

module.exports = class Neato {

	constructor() {
		Homey.log("Neato API initialised");
		this.config = Homey.app.config.api;
		this.oauthurl = "https://" + this.config.oauthHost + "/oauth2/authorize?client_id=" + this.config.id +
		  "&scope=control_robots+public_profile&response_type=code&redirect_uri=" + this.config.callback;
		
		this.isAuthorised();
	}
	
	// Handle Homey integration to oAuth
	authorize(callback) {
		Homey.log("Requested OAuth2 authorisation url");
		
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
					Homey.log("Neato->authorize->Failure!", error);
				}
				
				this.getToken.call(this, code)
					.then((auth_data) => {
						
						Homey.log("Neato->authorize->Success!", auth_data);
						this.config.authorisation = auth_data;
						
						this.isAuthorised.call(this)
							.then((user) => {
								Homey.log('User information: ', user);
								Homey.manager('api').realtime('authorized', true);
							})
							.catch(failed);
					})
					.catch(failed);
			}
		);
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
				Homey.log("Success", response)
			})
			.catch((error) => {
				Homey.log("error", error)
			});
		
		Homey.manager('settings').set('authorized', false);
		Homey.manager('settings').set('user', null);
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
				Homey.manager('settings').set('authorized', false);
				Homey.manager('settings').set('user', null);
				
				Homey.log("Not authorised: ", message);
				reject("Not authorised: " + message)
			}
			
			var token = Homey.manager('settings').get('accessToken');
			if(typeof(Homey.manager('settings').get('accessToken')) == 'undefined')
			{
				failed("No token stored");
			}
			else
			{
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
}