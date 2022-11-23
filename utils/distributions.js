// copied from http://www.randomservices.org/random/

function uniformSumCDF(n, x) {
  var sum = 0;
  if (x < 0) return 0;
  else if (x > n) return 1;
  else {
    for (var k = 0; k <= n; k++)
      sum = sum + Math.pow(-1, k) * binomial(n, k) * sgn(x - k) * Math.pow(x - k, n);
    return 0.5 + sum / (2 * factorial(n));
  }
}

function perm(n, k) {
  var p = 1;
  for (var i = 0; i < k; i++) p = p * (n - i);
  return p;
}

function factorial(n) {
  return perm(n, n);
}

function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  else {
    var p = 1;
    for (var i = 0; i < k; i++) p = p * ((n - i) / (k - i));
    return p;
  }
}

function sgn(x) {
  if (x > 0) return 1;
  else if (x < 0) return -1;
  else return 0;
}

module.exports.uniformSumCDF = uniformSumCDF;
