/** Entry point of the Home Assistant dashboard card bundle. */
import { version } from '../package.json';
import { CARD_TYPE } from './config.ts';
import './card.ts';

export { LogronoBusCard } from './card.ts';
export { normalizeConfig } from './config.ts';
export { cardFromEntity, cardsFromHass } from './entities.ts';

window.customCards ??= [];
if (!window.customCards.some((card) => card.type === CARD_TYPE)) {
  window.customCards.push({
    type: CARD_TYPE,
    name: 'Logroño Bus',
    description: 'Próximos autobuses de tus paradas, con el aspecto de la web de Logroño Bus.',
    preview: true,
  });
}

console.info(`%c LOGROÑO-BUS-CARD %c ${version} `, 'color:#fff;background:#8c1c2c', '');
