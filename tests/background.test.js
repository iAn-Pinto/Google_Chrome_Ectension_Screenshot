const { sanitizeOptions, retry, _test } = require('../background.js');

describe('sanitizeOptions', () => {
  test('defaults and normalization', () => {
    const out = sanitizeOptions({});
    expect(out.format).toBe('png');
    expect(out.quality).toBe(0.9);
    expect(out.filename).toBe('screenshot');
    expect(out.autoDownload).toBe(false); // sanitize coerces falsy to false
    expect(out.addTimestamp).toBe(false);
  });

  test('invalid fields sanitized', () => {
    const out = sanitizeOptions({ format: 'gif', quality: 5, filename: '  ', autoDownload: 'yes', addTimestamp: 1 });
    expect(out.format).toBe('png');
    expect(out.quality).toBe(0.9);
    expect(out.filename).toBe('screenshot');
    expect(out.autoDownload).toBe(true); // truthy coerced
    expect(out.addTimestamp).toBe(true);
  });

  test('filename characters sanitized', () => {
    const out = sanitizeOptions({ filename: 'bad name*&^%$#@!file' });
    expect(out.filename).toMatch(/^bad_name_file$/);
  });
});

describe('retry', () => {
  test('succeeds first try', async () => {
    const result = await retry(async () => 42, 3, 10);
    expect(result).toBe(42);
  });

  test('retries then succeeds', async () => {
    let attempts = 0;
    const result = await retry(async () => {
      attempts++;
      if (attempts < 2) throw new Error('fail');
      return 'ok';
    }, 3, 10);
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  test('fails after attempts', async () => {
    let attempts = 0;
    await expect(retry(async () => { attempts++; throw new Error('nope'); }, 2, 5)).rejects.toThrow('nope');
    expect(attempts).toBe(2);
  });
});
