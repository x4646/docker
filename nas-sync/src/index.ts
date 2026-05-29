import { Container } from './container/Container';
import config from '../config/default';

const container = new Container(config).build();
container.start(config.PORT);
