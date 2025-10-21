import 'dotenv/config';
import { createRestClient } from '@ln-markets/api';

const key = process.env.LNM_API_KEY;
const secret = process.env.LNM_API_SECRET;
const passphrase = process.env.LNM_API_PASSPHRASE;

export function createLnMarketsClient() {
  return createRestClient({
    key,
    secret,
    passphrase,
    network: 'mainnet', // ou 'mainnet' conforme necessário
  });
}