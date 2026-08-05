import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_MEDIA_SIZE_BYTES, meetsMinimumMediaSize, parseMediaName, parseRange, mimeFor } from '../server/media-utils.js';

test('extracts a movie title and year from common filenames', () => {
  assert.deepEqual(parseMediaName('Arrival.2016.1080p.BluRay.mkv'), {
    title: 'Arrival', year: 2016, seasonNumber: null, episodeNumber: null, mediaType: 'movie',
  });
});

test('extracts season and episode numbers', () => {
  assert.deepEqual(parseMediaName('Severance.S02E03.2160p.mkv'), {
    title: 'Severance', year: null, seasonNumber: 2, episodeNumber: 3, mediaType: 'episode',
  });
});

test('parses open, closed, and suffix byte ranges', () => {
  assert.deepEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=1000-', 1000), { invalid: true });
});

test('uses stable video MIME types', () => {
  assert.equal(mimeFor('/video/movie.mp4'), 'video/mp4');
  assert.equal(mimeFor('/video/movie.mkv'), 'video/x-matroska');
});

test('ignores media files smaller than 5 MB', () => {
  assert.equal(MIN_MEDIA_SIZE_BYTES, 5 * 1024 * 1024);
  assert.equal(meetsMinimumMediaSize(MIN_MEDIA_SIZE_BYTES - 1), false);
  assert.equal(meetsMinimumMediaSize(MIN_MEDIA_SIZE_BYTES), true);
  assert.equal(meetsMinimumMediaSize(MIN_MEDIA_SIZE_BYTES + 1), true);
});
