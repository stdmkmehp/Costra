// Feature Flag 读取门面 · 对齐 ADR-0004 §7
// Refs: COSTRA-030
import { isFlagOn, getEnv } from './env';

export const Flags = {
  familySharing: () => isFlagOn('family_sharing'),
  subscribeMsg: () => isFlagOn('subscribe_msg'),
  shareCardVariant: () => isFlagOn('share_card_variant'),
};

export function envName() {
  return getEnv().name;
}
