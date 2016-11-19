'use strict';

module.exports = [
  {
    description: 'Deauthorize Homey',
    method: 'PUT',
    path: '/deauthorize/',
    fn: (callback, args) => Homey.app.neato.deauthorize(callback)
  },
  {
    description: 'Authorize Homey',
    method: 'PUT',
    path: '/authorize/',
    fn: (callback, args) => Homey.app.neato.authorize(callback)
  }
];