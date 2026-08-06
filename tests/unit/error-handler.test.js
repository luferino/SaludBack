import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../../src/modules/shared/domain/errors.js';

function createRes() {
  const state = {};
  state.status = (code) => {
    state.statusCode = code;
    return state;
  };
  state.json = (body) => {
    state.body = body;
    return state;
  };
  return state;
}

test('AppError maps to its status code with a stable error code', () => {
  const cases = [
    [new BadRequestError(), 400, 'BAD_REQUEST'],
    [new ConflictError(), 409, 'CONFLICT'],
    [new UnauthorizedError(), 401, 'UNAUTHORIZED'],
  ];
  for (const [error, status, code] of cases) {
    const res = createRes();
    errorHandler(error, {}, res, () => {});
    assert.equal(res.statusCode, status);
    assert.equal(res.body.error.code, code);
    assert.equal(res.body.error.message, error.message);
  }
});

test('unknown errors become a generic 500 without leaking the message', () => {
  const res = createRes();
  errorHandler(new Error('secret internal detail'), {}, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.notEqual(res.body.error.message.includes('secret internal detail'), true);
});

test('middleware errors with an exposed 4xx status are honored, not 500', () => {
  // body-parser rejects malformed JSON with SyntaxError carrying status 400
  const res = createRes();
  const parseError = Object.assign(new SyntaxError('Unexpected token in JSON'), {
    statusCode: 400,
    status: 400,
    expose: true,
    type: 'entity.parse.failed',
  });
  errorHandler(parseError, {}, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'BAD_REQUEST');
});
