/**
 * Login Page UI
 * Email/password authentication form with error handling
 */

export function renderLoginPage() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>MeridianOS - Login</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .login-container {
          background: white;
          border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          width: 100%;
          max-width: 400px;
          padding: 40px;
        }

        .login-header {
          text-align: center;
          margin-bottom: 30px;
        }

        .login-header h1 {
          color: #333;
          font-size: 28px;
          margin-bottom: 8px;
        }

        .login-header p {
          color: #666;
          font-size: 14px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 500;
          color: #333;
        }

        .form-group input {
          padding: 12px 16px;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 14px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .form-group input:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .form-group input.error {
          border-color: #e53e3e;
        }

        .error-message {
          color: #e53e3e;
          font-size: 12px;
          display: none;
        }

        .error-message.visible {
          display: block;
        }

        .login-button {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 14px;
          border-radius: 6px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .login-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .login-button:active {
          transform: translateY(0);
        }

        .login-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .login-footer {
          margin-top: 24px;
          text-align: center;
          font-size: 13px;
          color: #666;
        }

        .login-footer a {
          color: #667eea;
          text-decoration: none;
        }

        .login-footer a:hover {
          text-decoration: underline;
        }

        .notification {
          position: fixed;
          top: 20px;
          right: 20px;
          padding: 16px 20px;
          border-radius: 8px;
          color: white;
          font-size: 14px;
          font-weight: 500;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          animation: slideIn 0.3s ease-out;
          max-width: 300px;
        }

        .notification.success {
          background: #48bb78;
        }

        .notification.error {
          background: #e53e3e;
        }

        .notification.info {
          background: #4299e1;
        }

        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        .loading-spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 0.8s linear infinite;
          margin-right: 8px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .hidden {
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <div class="login-header">
          <h1>MeridianOS</h1>
          <p>Multi-Tenant AI Platform</p>
        </div>

        <form id="login-form" class="login-form">
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required
                   placeholder="you@example.com"
                   autocomplete="email">
            <div class="error-message" id="email-error"></div>
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required
                   placeholder="••••••••"
                   autocomplete="current-password">
            <div class="error-message" id="password-error"></div>
          </div>

          <button type="submit" class="login-button" id="login-button">
            Sign In
          </button>
        </form>

        <div class="login-footer">
          <p>Don't have an account? <a href="/register">Contact your administrator</a></p>
        </div>
      </div>

      <script>
        const loginForm = document.getElementById('login-form');
        const loginButton = document.getElementById('login-button');
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');
        const emailError = document.getElementById('email-error');
        const passwordError = document.getElementById('password-error');

        // Clear errors on input
        emailInput.addEventListener('input', () => {
          emailInput.classList.remove('error');
          emailError.classList.remove('visible');
        });

        passwordInput.addEventListener('input', () => {
          passwordInput.classList.remove('error');
          passwordError.classList.remove('visible');
        });

        // Handle form submission
        loginForm.addEventListener('submit', async (e) => {
          e.preventDefault();

          // Clear previous errors
          emailInput.classList.remove('error');
          passwordInput.classList.remove('error');
          emailError.classList.remove('visible');
          passwordError.classList.remove('visible');

          const email = emailInput.value.trim();
          const password = passwordInput.value;

          // Validate email
          if (!email) {
            emailInput.classList.add('error');
            emailError.textContent = 'Email is required';
            emailError.classList.add('visible');
            return;
          }

          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            emailInput.classList.add('error');
            emailError.textContent = 'Please enter a valid email address';
            emailError.classList.add('visible');
            return;
          }

          // Validate password
          if (!password) {
            passwordInput.classList.add('error');
            passwordError.textContent = 'Password is required';
            passwordError.classList.add('visible');
            return;
          }

          // Show loading state
          loginButton.disabled = true;
          loginButton.innerHTML = '<span class="loading-spinner"></span>Signing in...';

          try {
            const response = await fetch('/api/auth/login', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (result.ok) {
              // Store token
              localStorage.setItem('meridianos_token', result.token);
              localStorage.setItem('meridianos_user', JSON.stringify(result.user));

              // Show success message
              showNotification('Login successful! Redirecting...', 'success');

              // Redirect to dashboard
              setTimeout(() => {
                window.location.href = '/';
              }, 1000);
            } else {
              // Show error
              showNotification(result.error || 'Login failed', 'error');
              loginButton.disabled = false;
              loginButton.textContent = 'Sign In';
            }
          } catch (error) {
            showNotification('Network error. Please try again.', 'error');
            loginButton.disabled = false;
            loginButton.textContent = 'Sign In';
          }
        });

        // Show notification
        function showNotification(message, type = 'info') {
          const notification = document.createElement('div');
          notification.className = \`notification \${type}\`;
          notification.textContent = message;
          document.body.appendChild(notification);

          setTimeout(() => {
            notification.remove();
          }, 3000);
        }

        // Check if already logged in
        const existingToken = localStorage.getItem('meridianos_token');
        if (existingToken) {
          // Verify token is still valid
          fetch('/api/auth/me', {
            headers: {
              'Authorization': \`Bearer \${existingToken}\`
            }
          })
          .then(response => response.json())
          .then(result => {
            if (result.ok) {
              window.location.href = '/';
            }
          })
          .catch(() => {
            // Token invalid, clear it
            localStorage.removeItem('meridianos_token');
            localStorage.removeItem('meridianos_user');
          });
        }
      </script>
    </body>
    </html>
  `;
}

/**
 * Initialize login page
 */
export function initLoginPage() {
  // Login page is self-contained in renderLoginPage()
  // This function is for future extensions
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  const token = localStorage.getItem('meridianos_token');
  return !!token;
}

/**
 * Get current user
 */
export function getCurrentUser() {
  const userStr = localStorage.getItem('meridianos_user');
  return userStr ? JSON.parse(userStr) : null;
}

/**
 * Logout user
 */
export function logout() {
  localStorage.removeItem('meridianos_token');
  localStorage.removeItem('meridianos_user');
  window.location.href = '/login';
}

/**
 * Require authentication for a route
 */
export function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = '/login';
    return false;
  }
  return true;
}