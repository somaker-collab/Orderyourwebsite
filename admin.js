const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.SESSION_SECRET || 'fallback_secret_do_not_use_in_prod';
const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_SECRET || 'admin123'; // Used strictly for first-time bootstrapping

// Auth Middleware
const requireAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.admin_token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Admin Login
router.post('/api/login', (req, res) => {
    const { password } = req.body;
    // In a full DB setup, you'd compare against an Admin model hash. Using bootstrap secret for standalone security constraint.
    if (password === ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
});

// Get all orders
router.get('/api/orders', requireAdmin, async (req, res) => {
    const Order = mongoose.model('Order');
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
});

// Update Order Status
router.put('/api/order/:id/status', requireAdmin, async (req, res) => {
    const { status, message } = req.body;
    const Order = mongoose.model('Order');
    try {
        const order = await Order.findById(req.params.id);
        order.status = status;
        order.history.push({ status, message });
        await order.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update order' });
    }
});

// Admin Dashboard UI
router.get('/*', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Admin Dashboard | Jagat Dahal</title>
        <script src="https://unpkg.com/lucide@latest"></script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
            :root {
                --bg: #1a202c; --text: #e2e8f0; --accent: #4facfe;
                --panel: #2d3748; --border: #4a5568;
            }
            body { margin: 0; font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); }
            * { box-sizing: border-box; }
            .hidden { display: none !important; }

            /* Login Screen */
            #login-screen { height: 100vh; display: flex; align-items: center; justify-content: center; }
            .login-box { background: var(--panel); padding: 40px; border-radius: 12px; width: 100%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            .input { width: 100%; padding: 12px; margin-bottom: 20px; background: var(--bg); border: 1px solid var(--border); color: white; border-radius: 8px; }
            .btn { width: 100%; padding: 12px; background: var(--accent); color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; }

            /* Layout */
            #app { display: flex; height: 100vh; overflow: hidden; }
            sidebar { width: 250px; background: var(--panel); border-right: 1px solid var(--border); padding: 20px; display:flex; flex-direction: column; }
            sidebar h2 { color: var(--accent); margin-bottom: 40px; }
            sidebar a { color: var(--text); text-decoration: none; padding: 12px; margin-bottom: 10px; border-radius: 8px; display: flex; gap: 10px; cursor:pointer; }
            sidebar a:hover { background: var(--bg); }
            main { flex: 1; padding: 40px; overflow-y: auto; }

            /* Table */
            table { width: 100%; border-collapse: collapse; margin-top: 20px; background: var(--panel); border-radius: 12px; overflow: hidden;}
            th, td { padding: 15px; text-align: left; border-bottom: 1px solid var(--border); }
            th { background: #344054; }
            .badge { padding: 5px 10px; border-radius: 20px; font-size: 0.8rem; background: var(--bg); border: 1px solid var(--accent); }

            /* Modal */
            #modal { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 1000;}
            .modal-content { background: var(--panel); padding: 30px; border-radius: 12px; width: 100%; max-width: 600px; }
        </style>
    </head>
    <body>
        <!-- LOGIN -->
        <div id="login-screen">
            <div class="login-box">
                <h2 style="text-align: center; color: var(--accent);">Admin Area</h2>
                <input type="password" id="admin-pass" class="input" placeholder="Enter Admin Password">
                <button class="btn" onclick="login()">Login</button>
            </div>
        </div>

        <!-- DASHBOARD -->
        <div id="app" class="hidden">
            <sidebar>
                <h2>JD Panel</h2>
                <a onclick="loadOrders()"><i data-lucide="list"></i> Orders</a>
                <a onclick="logout()"><i data-lucide="log-out"></i> Logout</a>
            </sidebar>
            <main>
                <h1>Manage Orders</h1>
                <table id="orders-table">
                    <thead><tr><th>Token</th><th>Client</th><th>Type</th><th>Budget</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody id="orders-body"></tbody>
                </table>
            </main>
        </div>

        <!-- MODAL -->
        <div id="modal" class="hidden">
            <div class="modal-content">
                <h2 id="m-title">Update Order</h2>
                <p>Status flow: Pending -> Under Review -> Accepted/Rejected -> Development -> Completed</p>
                
                <input type="hidden" id="m-id">
                <select id="m-status" class="input">
                    <option value="Pending Review">Pending Review</option>
                    <option value="Under Review">Under Review</option>
                    <option value="Accepted">Accepted</option>
                    <option value="Requirements Discussion">Requirements Discussion</option>
                    <option value="Development in Progress">Development in Progress</option>
                    <option value="Client Review">Client Review</option>
                    <option value="Completed">Completed</option>
                    <option value="Rejected">Rejected</option>
                </select>
                <textarea id="m-msg" class="input" rows="4" placeholder="Message to client..."></textarea>
                
                <div style="display: flex; gap: 10px;">
                    <button class="btn" onclick="saveStatus()">Save Update</button>
                    <button class="btn" style="background: #e53e3e;" onclick="closeModal()">Cancel</button>
                </div>
            </div>
        </div>

        <script>
            lucide.createIcons();
            let token = localStorage.getItem('adminToken');
            
            if(token) showApp();

            async function login() {
                const pass = document.getElementById('admin-pass').value;
                const res = await fetch('/admin/api/login', {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({password: pass})
                });
                const data = await res.json();
                if(data.success) {
                    token = data.token;
                    localStorage.setItem('adminToken', token);
                    showApp();
                } else alert('Invalid password');
            }

            function showApp() {
                document.getElementById('login-screen').classList.add('hidden');
                document.getElementById('app').classList.remove('hidden');
                loadOrders();
            }

            function logout() {
                localStorage.removeItem('adminToken');
                location.reload();
            }

            async function loadOrders() {
                const res = await fetch('/admin/api/orders', { headers: { 'Authorization': 'Bearer ' + token } });
                if(res.status === 401) return logout();
                const orders = await res.json();
                
                const tbody = document.getElementById('orders-body');
                tbody.innerHTML = orders.map(o => \`
                    <tr>
                        <td><strong>\${o.token}</strong></td>
                        <td>\${o.customerName}<br><small style="color:gray;">\${o.email}</small></td>
                        <td>\${o.websiteType}</td>
                        <td>\${o.budget}</td>
                        <td><span class="badge">\${o.status}</span></td>
                        <td><button class="btn" style="padding: 6px 12px;" onclick="openModal('\${o._id}', '\${o.status}')">Manage</button></td>
                    </tr>
                \`).join('');
            }

            function openModal(id, currentStatus) {
                document.getElementById('m-id').value = id;
                document.getElementById('m-status').value = currentStatus;
                document.getElementById('m-msg').value = '';
                document.getElementById('modal').classList.remove('hidden');
            }

            function closeModal() { document.getElementById('modal').classList.add('hidden'); }

            async function saveStatus() {
                const id = document.getElementById('m-id').value;
                const status = document.getElementById('m-status').value;
                const message = document.getElementById('m-msg').value;

                await fetch('/admin/api/order/' + id + '/status', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ status, message })
                });
                closeModal();
                loadOrders();
            }
        </script>
    </body>
    </html>
    `);
});

module.exports = router;