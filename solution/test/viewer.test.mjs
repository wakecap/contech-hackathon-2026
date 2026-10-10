import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedRerun } from '../../demo/viewer_auth.mjs';

test('local reruns accept a session token when embedded browsers rewrite Origin', () => {
  const token='test-session-token';
  for(const origin of ['http://localhost:8811','http://127.0.0.1:8811','null',undefined]) {
    assert.equal(authorizedRerun({origin,'x-viewer-token':token},token),true);
    assert.equal(authorizedRerun({origin},token),false);
    assert.equal(authorizedRerun({origin,'x-viewer-token':'expired'},token),false);
  }
  assert.equal(authorizedRerun({'x-viewer-token':''},''),false);
});
