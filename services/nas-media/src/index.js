const { Container } = require('./container/Container');
const config = require('../config/default');

new Container(config).build().start(config.PORT);
