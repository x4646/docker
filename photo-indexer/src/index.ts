import { Container } from './container/Container';
import config from '../config/default';

new Container(config).build().start(config.PORT);
