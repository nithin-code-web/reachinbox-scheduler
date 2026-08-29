import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env.js';

const elasticsearchOptions = {
  node: env.ELASTICSEARCH_NODE,
  ...(env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD
    ? { auth: { username: env.ELASTICSEARCH_USERNAME, password: env.ELASTICSEARCH_PASSWORD } }
    : {}),
};

export const elasticsearchClient = new Client(elasticsearchOptions);

export async function closeElasticsearch(): Promise<void> {
  await elasticsearchClient.close();
}
