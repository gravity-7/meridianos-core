import crypto from 'node:crypto';

export class OAuthProvider {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Get provider configuration
   * @param {string} providerName - 'github', 'google', 'azure'
   */
  getProviderConfig(providerName) {
    const providerConfigs = {
      github: {
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userUrl: 'https://api.github.com/user',
        scope: 'read:user user:email'
      },
      google: {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
        scope: 'email profile'
      },
      azure: {
        authUrl: `https://login.microsoftonline.com/${this.config.azureTenantId || 'common'}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${this.config.azureTenantId || 'common'}/oauth2/v2.0/token`,
        userUrl: 'https://graph.microsoft.com/oidc/userinfo',
        scope: 'openid email profile'
      }
    };
    
    if (!providerConfigs[providerName]) {
      throw new Error(`Unknown OAuth provider: ${providerName}`);
    }
    
    // Merge with client credentials from policy
    const clientConfig = this.config[providerName] || {};
    return {
      ...providerConfigs[providerName],
      clientId: clientConfig.clientId || process.env[`OAUTH_${providerName.toUpperCase()}_CLIENT_ID`],
      clientSecret: clientConfig.clientSecret || process.env[`OAUTH_${providerName.toUpperCase()}_CLIENT_SECRET`],
      redirectUri: clientConfig.redirectUri || `http://localhost:4320/api/auth/oauth/${providerName}/callback`
    };
  }

  /**
   * Generate authorization URL
   */
  getAuthorizeUrl(providerName, state) {
    const config = this.getProviderConfig(providerName);
    if (!config.clientId) {
      throw new Error(`Missing client ID for provider ${providerName}`);
    }
    
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scope,
      state: state || crypto.randomUUID()
    });
    
    return `${config.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange code for token
   */
  async exchangeCode(providerName, code) {
    const config = this.getProviderConfig(providerName);
    
    const params = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code'
    });
    
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: params.toString()
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to exchange token: ${errText}`);
    }
    
    return response.json();
  }

  /**
   * Fetch user info
   */
  async getUserInfo(providerName, accessToken) {
    const config = this.getProviderConfig(providerName);

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    };

    if (providerName === 'github') {
      headers['X-GitHub-Api-Version'] = '2022-11-28';
    }

    const response = await fetch(config.userUrl, { headers });

    if (!response.ok) {
      throw new Error('Failed to fetch user info');
    }

    const user = await response.json();

    // Normalize user info
    if (providerName === 'github') {
      // GitHub might not return email if it's private, needs extra API call in real app
      return {
        id: String(user.id),
        email: user.email || `${user.login}@users.noreply.github.com`,
        name: user.name || user.login
      };
    }

    return {
      id: user.id || user.sub,
      email: user.email,
      name: user.name
    };
  }

  /**
   * Verify ID token signature and claims (OIDC-specific)
   */
  async verifyIdToken(idToken) {
    try {
      // Decode JWT without verification
      const decoded = jwt.verifyToken(idToken);

      // Verify issuer
      if (decoded.iss !== this.config.issuer) {
        throw new Error('Invalid issuer');
      }

      // Verify audience
      if (!decoded.aud.includes(this.config.clientId)) {
        throw new Error('Invalid audience');
      }

      // Verify expiration
      if (decoded.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('Token expired');
      }

      return decoded;
    } catch (error) {
      throw new Error(`ID token verification failed: ${error.message}`);
    }
  }

  /**
   * Generate state parameter for CSRF protection
   */
  static generateState() {
    return crypto.randomUUID();
  }
}

// Singleton
let oauthProviderInstance = null;
export function getOAuthProvider(config) {
  if (!oauthProviderInstance) {
    oauthProviderInstance = new OAuthProvider(config);
  }
  return oauthProviderInstance;
}
