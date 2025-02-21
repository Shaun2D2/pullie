const assume = require('assume');
const fs = require('fs');
const nock = require('nock');
const path = require('path');
const request = require('request');
const pullieApp = require('../../');
const { Probot } = require('probot');
const { assumeValidResponse } = require('./helpers');
const openPRPayload = require('../fixtures/payloads/open-pr.json');
const mockOrgPullieRC = require('../fixtures/payloads/mock-org-pullierc.json');
const mockPullieRC = require('../fixtures/payloads/mock-pullierc.json');
const mockPackageJson = require('../fixtures/payloads/mock-packagejson.json');

function nockFile(scope, urlPath, contents, repo = 'repo') {
  scope.get(`/api/v3/repos/org/${repo}/contents/` + urlPath)
    .reply(200, {
      content: Buffer.from(contents).toString('base64'),
      path: urlPath
    });
}

describe('Pullie (integration)', function () {
  /** @type {Probot} */
  let pullie;
  let mockCert;

  before(function (done) {
    fs.readFile(path.join(__dirname, '../fixtures/mock-key.pem'), (err, cert) => {
      if (err) return done(err);
      mockCert = cert;
      done();
    });
  });

  before(function () {
    const github = nock('https://github.test.fake')
      .post('/api/v3/app/installations/1/access_tokens')
      .reply(201, {
        token: 'mock_token',
        expires_at: '9999-12-31T00:00:00Z'
      })
      .get('/api/v3/repos/org/repo/collaborators/jsmith')
      .reply(204)
      .get('/api/v3/repos/org/repo/pulls/165/files')
      .reply(200, [
        {
          filename: 'CHANGELOG.md'
        }
      ])
      .post('/api/v3/repos/org/repo/pulls/165/requested_reviewers')
      .reply(200)
      .post('/api/v3/repos/org/repo/issues/165/comments')
      .reply(200);

    nockFile(github, '.pullierc', JSON.stringify(mockOrgPullieRC), '.github');
    nockFile(github, '.pullierc', JSON.stringify(mockPullieRC));
    nockFile(github, 'package.json', JSON.stringify(mockPackageJson));
    nockFile(github, 'CHANGELOG.md', '# Mock changelog');

    nock('https://jira.test.fake')
      .post('/rest/api/2/search')
      .reply(200, {
        issues: [
          {
            key: 'AB-1234',
            fields: {
              summary: 'Mock ticket 1 title'
            }
          },
          {
            key: 'FOO-5678',
            fields: {
              summary: 'Mock ticket 2 title'
            }
          }
        ]
      });
  });

  before(function () {
    process.env.GHE_HOST = 'github.test.fake';
    process.env.JIRA_PROTOCOL = 'https';
    process.env.JIRA_HOST = 'jira.test.fake';
    process.env.JIRA_USERNAME = 'test_user';
    process.env.JIRA_PASSWORD = 'test_password';
    pullie = new Probot({ id: 123, cert: mockCert });
    pullie.load(pullieApp);
  });

  after(function () {
    nock.restore();
  });

  describe('API', function () {
    before(function () {
      nock.disableNetConnect();
    });

    after(function () {
      nock.enableNetConnect();
    });

    it('properly processes a pull request', async function () {
      this.timeout(5000);
      await pullie.receive({
        id: 'mock',
        name: 'pull_request',
        payload: openPRPayload
      });
      assume(nock.isDone()).is.true();
    });
  });

  describe('Docs', function () {
    let baseUrl;
    before(function () {
      pullie.start();
      // @ts-ignore
      const { port } = pullie.httpServer.address();
      baseUrl = `http://localhost:${port}/docs`;
    });

    after(function (done) {
      pullie.httpServer.close(done);
    });

    it('serves documentation at host root', function (done) {
      assumeValidResponse(baseUrl, '<!DOCTYPE html>', done);
    });

    it('serves Prism CSS properly', function (done) {
      assumeValidResponse(baseUrl + '/prism-coy.css', 'prism', done);
    });

    it('serves healthcheck properly', function (done) {
      assumeValidResponse(baseUrl + '/healthcheck.html', 'page ok', done);
    });

    it('serves static files properly', function (done) {
      assumeValidResponse(baseUrl + '/static/pullie.svg', 'svg', done);
    });
  });

  describe('No Docs', function () {
    let baseUrl;

    before(function () {
      process.env.DISABLE_DOCS_ROUTE = 'true';
      pullie = new Probot({ id: 123, cert: mockCert });
      pullie.load(pullieApp);
      pullie.start();
      // @ts-ignore
      const { port } = pullie.httpServer.address();
      baseUrl = `http://localhost:${port}/docs`;
    });

    after(function (done) {
      pullie.httpServer.close(done);
    });

    it('does not initialize the docs route when DISABLE_DOCS_ROUTE is set', function (done) {
      request(baseUrl, (err, res) => {
        assume(err).is.falsey();
        assume(res).hasOwn('statusCode', 404);

        done();
      });
    });
  });
});
