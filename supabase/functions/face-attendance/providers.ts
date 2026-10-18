import {awsProvider} from './aws-provider.ts';
import {selfHostedProvider} from './self-hosted-provider.mjs';
export function providers(env: Record<string,string|undefined>) {
  const cache = new Map<string,ReturnType<typeof awsProvider>|ReturnType<typeof selfHostedProvider>>();
  return (kind: string) => {
    if (kind !== 'aws' && kind !== 'self_hosted') throw new Error('Unsupported biometric provider');
    if (!cache.has(kind)) cache.set(kind,kind === 'aws' ? awsProvider(env) : selfHostedProvider(env));
    return cache.get(kind)!;
  };
}
