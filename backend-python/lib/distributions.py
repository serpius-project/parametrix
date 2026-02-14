"""Distribution classes and builder for parametric insurance."""

import numpy as np
from scipy import stats


class LogitNormalDist:
    """
    LogitNormal distribution with scipy-like interface.

    If X ~ LogitNormal(mu, sigma), then logit(X) ~ Normal(mu, sigma).
    Support: (0, 1).
    """

    def __init__(self, mu: float, sigma: float):
        self.mu = mu
        self.sigma = sigma

    def cdf(self, x):
        x = np.clip(x, 1e-12, 1 - 1e-12)
        logit_x = np.log(x / (1 - x))
        return stats.norm.cdf(logit_x, self.mu, self.sigma)

    def sf(self, x):
        return 1.0 - self.cdf(x)

    def pdf(self, x):
        x = np.clip(x, 1e-12, 1 - 1e-12)
        logit_x = np.log(x / (1 - x))
        return stats.norm.pdf(logit_x, self.mu, self.sigma) / (x * (1 - x))

    def ppf(self, q):
        z = stats.norm.ppf(q, self.mu, self.sigma)
        return 1.0 / (1.0 + np.exp(-z))

    def std(self):
        return float(self.ppf(0.841) - self.ppf(0.159)) / 2.0


def build_distribution(family: str, params: dict):
    """Reconstruct a frozen scipy distribution from stored parameters."""
    if family == "genextreme":
        return stats.genextreme(c=params["c"], loc=params["loc"], scale=params["scale"])
    elif family == "weibull_min":
        return stats.weibull_min(c=params["c"], loc=params["loc"], scale=params["scale"])
    elif family == "logitnormal":
        return LogitNormalDist(mu=params["mu"], sigma=params["sigma"])
    elif family == "johnsonsu":
        return stats.johnsonsu(a=params["a"], b=params["b"], loc=params["loc"], scale=params["scale"])
    else:
        raise ValueError(f"Unknown distribution family: {family}")
