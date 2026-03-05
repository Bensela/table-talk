import { expect } from 'chai';
import { SCANNER_ROUTE, ROUTES } from '../../frontend/src/constants/routes.js';

describe('Start Fresh Routing', () => {
  it('Should define SCANNER_ROUTE as the home/root path', () => {
    expect(SCANNER_ROUTE).to.equal('/');
    expect(SCANNER_ROUTE).to.equal(ROUTES.HOME);
  });

  it('Should NOT route to Welcome page', () => {
    expect(SCANNER_ROUTE).to.not.include('/t/');
    expect(SCANNER_ROUTE).to.not.equal(ROUTES.WELCOME);
  });
});
