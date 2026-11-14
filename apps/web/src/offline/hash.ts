import { sha256 } from 'js-sha256';

// The same synchronous UTF-8 SHA-256 used for rule digests and decision IDs in Node.
export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error('Unsupported hash: ' + algorithm);
  return {
    update(input: string) {
      return {
        digest: (format: string) => {
          if (format !== 'hex') throw new Error('Unsupported digest format: ' + format);
          return sha256(input);
        },
      };
    },
  };
}
