require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const adminApp = require('./admin'); // Import admin module

const app = express();

// Security & Middleware
app.use(helmet({ contentSecurityPolicy: false })); // Disabled strictly for inline UI scripts in this 4-file structure
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Global MongoDB Connection (Serverless Pattern)
let cachedDb = global.mongoose;
if (!cachedDb) cachedDb = global.mongoose = { conn: null, promise: null };

async function connectDB() {
    if (cachedDb.conn) return cachedDb.conn;
    if (!cachedDb.promise) {
        mongoose.set('strictQuery', true);
        cachedDb.promise = mongoose.connect(process.env.MONGODB_URI, {}).then(m => m);
    }
    cachedDb.conn = await cachedDb.promise;
    return cachedDb.conn;
}

// Ensure connection on every request
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// Models
const OrderSchema = new mongoose.Schema({
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    whatsapp: { type: String, required: true },
    phone: String,
    method: String,
    websiteType: { type: String, required: true },
    title: String,
    budget: String,
    timeline: String,
    features: [String],
    description: String,
    token: { type: String, unique: true, required: true },
    status: { type: String, default: 'Pending Review' },
    history: [{ status: String, message: String, date: { type: Date, default: Date.now } }],
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

const ChatSchema = new mongoose.Schema({
    sessionId: { type: String, unique: true, required: true },
    messages: [{ role: String, content: String, date: { type: Date, default: Date.now } }],
    updatedAt: { type: Date, default: Date.now }
});
const Chat = mongoose.models.Chat || mongoose.model('Chat', ChatSchema);

// Mount Admin Router
app.use('/admin', adminApp);

// Public APIs
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// Submit Order
app.post('/api/order', async (req, res) => {
    try {
        const token = crypto.randomBytes(4).toString('hex').toUpperCase();
        const newOrder = new Order({ ...req.body, token });
        newOrder.history.push({ status: 'Pending Review', message: 'Order has been successfully submitted and is awaiting review by Jagat Dahal.' });
        await newOrder.save();
        res.json({ success: true, token });
    } catch (err) {
        res.status(400).json({ success: false, error: 'Failed to submit order. Please check inputs.' });
    }
});

// Track Order
app.get('/api/order/:token', async (req, res) => {
    try {
        const order = await Order.findOne({ token: req.params.token.toUpperCase() }, '-_id -__v');
        if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
        res.json({ success: true, order });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// AI Customer Support Chat
app.post('/api/chat', async (req, res) => {
    const { sessionId, message } = req.body;
    try {
        let chat = await Chat.findOne({ sessionId });
        if (!chat) chat = new Chat({ sessionId, messages: [] });

        chat.messages.push({ role: 'user', content: message });

        const systemPrompt = `You are a professional AI assistant for Jagat Dahal, a software developer based in Kathmandu, Nepal. 
        Email: jagatdahal754@gmail.com. Currency: NPR. Services: Custom websites, portfolios, e-commerce, web apps. 
        Be helpful, concise, and professional. Explain the order process: users request an order, get a token, track it, and wait for manual review.`;

        let aiContent = "";
        
        // Primary: Gemini
        try {
            if(!process.env.GEMINI_API_KEY) throw new Error("Gemini Missing");
            const gRes = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                contents: [
                    { role: 'user', parts: [{ text: systemPrompt }] },
                    ...chat.messages.slice(-5).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }))
                ]
            });
            aiContent = gRes.data.candidates[0].content.parts[0].text;
        } catch (geminiError) {
            // Fallback: OpenRouter
            try {
                if(!process.env.OPENROUTER_API_KEY) throw new Error("OpenRouter Missing");
                const orRes = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                    model: "meta-llama/llama-3-8b-instruct:free",
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...chat.messages.slice(-5).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
                    ]
                }, { headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` } });
                aiContent = orRes.data.choices[0].message.content;
            } catch (orError) {
                aiContent = "I'm currently experiencing high traffic. Please try again later or contact Jagat directly at jagatdahal754@gmail.com.";
            }
        }

        chat.messages.push({ role: 'assistant', content: aiContent });
        chat.updatedAt = Date.now();
        await chat.save();

        res.json({ success: true, reply: aiContent });
    } catch (err) {
        res.status(500).json({ success: false, reply: "System error occurred." });
    }
});

// Public UI Rendering
app.get('*', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Jagat Dahal | Custom Web Development</title>
        <script src="https://unpkg.com/lucide@latest"></script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap');
            :root {
                --bg: #e8f0f8;
                --text: #2d3748;
                --text-light: #718096;
                --accent-1: #4facfe;
                --accent-2: #00f2fe;
                --accent-3: #a18cd1;
                --shadow-dark: #cad3df;
                --shadow-light: #ffffff;
            }
            body { margin: 0; font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); overflow-x: hidden; }
            * { box-sizing: border-box; transition: all 0.3s ease; }
            
            /* Claymorphism Utilities */
            .clay {
                background: var(--bg); border-radius: 24px;
                box-shadow: 12px 12px 24px var(--shadow-dark), -12px -12px 24px var(--shadow-light);
            }
            .clay-btn {
                background: linear-gradient(135deg, var(--accent-1) 0%, var(--accent-2) 100%);
                color: white; border: none; padding: 14px 28px; border-radius: 16px; font-weight: 600; cursor: pointer;
                box-shadow: 6px 6px 12px var(--shadow-dark), -6px -6px 12px var(--shadow-light); font-size: 1rem;
            }
            .clay-btn:active { box-shadow: inset 4px 4px 8px rgba(0,0,0,0.1), inset -4px -4px 8px rgba(255,255,255,0.2); }
            .clay-btn-outline {
                background: var(--bg); color: var(--accent-1); border: 2px solid var(--accent-1);
            }
            .clay-input {
                width: 100%; padding: 16px; background: var(--bg); border: none; border-radius: 16px; font-size: 1rem; color: var(--text);
                box-shadow: inset 6px 6px 12px var(--shadow-dark), inset -6px -6px 12px var(--shadow-light); outline: none;
            }
            .clay-input:focus { box-shadow: inset 8px 8px 16px var(--shadow-dark), inset -8px -8px 16px var(--shadow-light); }

            /* Layout */
            header { display: flex; justify-content: space-between; align-items: center; padding: 20px 5%; background: rgba(232,240,248,0.8); backdrop-filter: blur(10px); position: sticky; top: 0; z-index: 100;}
            header h1 { font-size: 1.5rem; margin: 0; background: -webkit-linear-gradient(var(--accent-1), var(--accent-3)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            nav gap { display: flex; gap: 20px; }
            nav a { color: var(--text); text-decoration: none; font-weight: 600; cursor: pointer; }
            
            section { padding: 80px 5%; min-height: 80vh; display: flex; flex-direction: column; justify-content: center; align-items: center; }
            .hero { text-align: center; position: relative; }
            .hero h2 { font-size: 3.5rem; margin-bottom: 10px; }
            .hero p { font-size: 1.2rem; color: var(--text-light); max-width: 600px; margin-bottom: 40px; }
            
            /* Grid */
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 40px; width: 100%; max-width: 1200px; margin-top: 40px; }
            .card { padding: 30px; display: flex; flex-direction: column; align-items: center; text-align: center; }
            .card i { color: var(--accent-1); margin-bottom: 20px; }
            
            /* Forms */
            .form-container { width: 100%; max-width: 800px; padding: 40px; }
            .form-group { margin-bottom: 24px; text-align: left; width: 100%; }
            .form-group label { display: block; margin-bottom: 8px; font-weight: 600; }
            .features-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
            .feature-checkbox { display: flex; align-items: center; gap: 10px; cursor: pointer; }

            /* Chatbot */
            #chat-widget { position: fixed; bottom: 30px; right: 30px; z-index: 1000; }
            #chat-btn { width: 60px; height: 60px; border-radius: 30px; display: flex; align-items: center; justify-content: center; }
            #chat-window { display: none; width: 350px; height: 500px; position: absolute; bottom: 80px; right: 0; padding: 20px; flex-direction: column; }
            #chat-messages { flex: 1; overflow-y: auto; margin-bottom: 15px; display: flex; flex-direction: column; gap: 10px; }
            .msg { padding: 12px; border-radius: 12px; max-width: 85%; line-height: 1.4; font-size: 0.9rem; }
            .msg.user { align-self: flex-end; background: var(--accent-1); color: white; border-bottom-right-radius: 0; }
            .msg.bot { align-self: flex-start; background: #fff; box-shadow: 2px 2px 8px var(--shadow-dark); border-bottom-left-radius: 0; }
            .chat-input-area { display: flex; gap: 10px; }

            /* Tracking Timeline */
            .timeline { border-left: 3px solid var(--accent-1); padding-left: 20px; margin-top: 20px; }
            .timeline-item { position: relative; margin-bottom: 20px; }
            .timeline-item::before { content: ''; position: absolute; left: -28.5px; top: 0; width: 14px; height: 14px; border-radius: 50%; background: var(--accent-1); }

            /* Utilities */
            .hidden { display: none !important; }
            .toast { position: fixed; top: 20px; right: 20px; padding: 15px 25px; background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 2000; transform: translateX(150%); }

            @media(max-width: 768px) {
                .hero h2 { font-size: 2.5rem; }
                .features-grid { grid-template-columns: 1fr; }
                #chat-window { width: calc(100vw - 40px); right: -10px; }
            }
        </style>
    </head>
    <body>
        <div id="toast" class="toast"></div>

        <header>
            <h1>Jagat Dahal.</h1>
            <nav>
                <a onclick="showSection('home')">Home</a>
                <a onclick="showSection('services')">Services</a>
                <a onclick="showSection('track')">Track</a>
            </nav>
            <button class="clay-btn clay-btn-outline" onclick="showSection('order')" style="padding: 8px 16px;">Order Now</button>
        </header>

        <!-- HOME SECTION -->
        <section id="home">
            <div class="hero">
                <h2>Your Vision. Our Code.<br><span style="color: var(--accent-1);">Your Website.</span></h2>
                <p>Professional custom website development and software solutions based in Kathmandu, Nepal. Submit your project requirements and track real-time progress online.</p>
                <div style="display: flex; gap: 20px; justify-content: center; flex-wrap: wrap;">
                    <button class="clay-btn" onclick="showSection('order')">Order Your Website</button>
                    <button class="clay-btn clay-btn-outline" onclick="showSection('track')">Track Your Project</button>
                </div>
            </div>
            
            <div class="grid" style="margin-top: 80px;">
                <div class="card clay">
                    <i data-lucide="layout-template" size="48"></i>
                    <h3>Custom Designs</h3>
                    <p>Beautiful, responsive premium designs tailored to your specific brand identity.</p>
                </div>
                <div class="card clay">
                    <i data-lucide="code" size="48"></i>
                    <h3>Robust Backends</h3>
                    <p>Secure APIs, databases, and admin dashboards using modern technologies.</p>
                </div>
                <div class="card clay">
                    <i data-lucide="bar-chart" size="48"></i>
                    <h3>Transparent Tracking</h3>
                    <p>Get a unique tracking token and monitor your project milestones directly.</p>
                </div>
            </div>
        </section>

        <!-- SERVICES SECTION -->
        <section id="services" class="hidden">
            <h2>Our Services</h2>
            <p>Select a service to start your order instantly.</p>
            <div class="grid">
                <div class="card clay">
                    <i data-lucide="building" size="40"></i>
                    <h3>Business Websites</h3>
                    <p>Corporate identity, landing pages, and lead generation systems.</p>
                    <button class="clay-btn" style="margin-top:20px" onclick="prefillOrder('Business Website')">Order</button>
                </div>
                <div class="card clay">
                    <i data-lucide="shopping-cart" size="40"></i>
                    <h3>E-Commerce</h3>
                    <p>Full online stores with carts, product management, and payments.</p>
                    <button class="clay-btn" style="margin-top:20px" onclick="prefillOrder('E-commerce Website')">Order</button>
                </div>
                <div class="card clay">
                    <i data-lucide="calendar" size="40"></i>
                    <h3>Booking Systems</h3>
                    <p>Perfect for dental clinics, hospitals, and consultation services.</p>
                    <button class="clay-btn" style="margin-top:20px" onclick="prefillOrder('Booking or Appointment Website')">Order</button>
                </div>
                <div class="card clay">
                    <i data-lucide="app-window" size="40"></i>
                    <h3>Custom Web Apps</h3>
                    <p>Complex dashboards, SaaS tools, and tailored management systems.</p>
                    <button class="clay-btn" style="margin-top:20px" onclick="prefillOrder('Web Application')">Order</button>
                </div>
            </div>
        </section>

        <!-- ORDER FORM SECTION -->
        <section id="order" class="hidden">
            <h2>Order Your Website</h2>
            <p>Please provide detailed requirements so we can evaluate your project effectively.</p>
            
            <div class="form-container clay" id="order-box">
                <form id="orderForm" onsubmit="submitOrder(event)">
                    <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                        <div class="form-group"><label>Full Name *</label><input type="text" id="o_name" class="clay-input" required></div>
                        <div class="form-group"><label>Email Address *</label><input type="email" id="o_email" class="clay-input" required></div>
                    </div>
                    <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                        <div class="form-group"><label>WhatsApp Number *</label><input type="text" id="o_wa" class="clay-input" placeholder="+977..." required></div>
                        <div class="form-group"><label>Project Title</label><input type="text" id="o_title" class="clay-input"></div>
                    </div>
                    
                    <div class="form-group">
                        <label>Website Type *</label>
                        <select id="o_type" class="clay-input" required>
                            <option value="">Select an option</option>
                            <option value="Business Website">Business Website</option>
                            <option value="Portfolio Website">Portfolio Website</option>
                            <option value="E-commerce Website">E-commerce Website</option>
                            <option value="Booking or Appointment Website">Booking System</option>
                            <option value="Clinic or Hospital Website">Clinic Website</option>
                            <option value="Web Application">Custom Web Application</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>Estimated Budget (NPR) *</label>
                        <select id="o_budget" class="clay-input" required>
                            <option value="Under Rs. 10,000">Under Rs. 10,000</option>
                            <option value="Rs. 10,000 - 25,000">Rs. 10,000 - 25,000</option>
                            <option value="Rs. 25,000 - 50,000">Rs. 25,000 - 50,000</option>
                            <option value="Rs. 50,000 - 100,000">Rs. 50,000 - 100,000</option>
                            <option value="Above Rs. 100,000">Above Rs. 100,000</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>Required Features</label>
                        <div class="features-grid">
                            <label class="feature-checkbox"><input type="checkbox" value="Responsive Design" class="f-check"> Responsive Design</label>
                            <label class="feature-checkbox"><input type="checkbox" value="Admin Dashboard" class="f-check"> Admin Dashboard</label>
                            <label class="feature-checkbox"><input type="checkbox" value="User Login" class="f-check"> User Registration & Login</label>
                            <label class="feature-checkbox"><input type="checkbox" value="Online Payments" class="f-check"> Online Payments</label>
                            <label class="feature-checkbox"><input type="checkbox" value="Appointment Booking" class="f-check"> Appointment Booking</label>
                            <label class="feature-checkbox"><input type="checkbox" value="AI Assistant" class="f-check"> AI Assistant Integration</label>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Detailed Description *</label>
                        <textarea id="o_desc" class="clay-input" rows="5" required placeholder="Describe the purpose, target audience, pages needed..."></textarea>
                    </div>
                    
                    <button type="submit" class="clay-btn" style="width: 100%;" id="orderSubmitBtn">Submit Project Request</button>
                </form>
            </div>

            <!-- Success Box -->
            <div id="success-box" class="form-container clay hidden" style="text-align: center;">
                <i data-lucide="check-circle" size="64" style="color: #48bb78; margin-bottom: 20px;"></i>
                <h2>Request Submitted!</h2>
                <p>Your website request has been submitted successfully. Save your unique tracking token below to check your project's progress.</p>
                <div class="clay-input" style="font-size: 2rem; font-weight: 800; letter-spacing: 4px; margin: 20px 0; color: var(--accent-1);" id="display-token"></div>
                <button class="clay-btn" onclick="copyToken()">Copy Token</button>
                <button class="clay-btn clay-btn-outline" onclick="showSection('track')">Go to Tracking</button>
            </div>
        </section>

        <!-- TRACKING SECTION -->
        <section id="track" class="hidden">
            <h2>Track Your Project</h2>
            <p>Enter your tracking token to view real-time status updates.</p>
            
            <div class="form-container clay" style="max-width: 500px; text-align: center;">
                <input type="text" id="track-token" class="clay-input" placeholder="e.g. A1B2C3D4" style="text-align: center; text-transform: uppercase; font-weight: 800; letter-spacing: 2px;">
                <button class="clay-btn" style="width: 100%; margin-top: 20px;" onclick="trackOrder()">Track Status</button>
            </div>

            <div id="track-result" class="form-container clay hidden" style="margin-top: 40px; text-align: left;">
                <div style="display:flex; justify-content: space-between; border-bottom: 2px solid var(--bg); padding-bottom: 20px; margin-bottom: 20px;">
                    <div>
                        <h3 id="tr-title" style="margin:0;">Project Title</h3>
                        <span id="tr-type" style="color: var(--text-light);">Type</span>
                    </div>
                    <div style="text-align:right;">
                        <div id="tr-status" style="font-weight: 800; color: var(--accent-1);">Status</div>
                        <span id="tr-date" style="font-size: 0.8rem;">Date</span>
                    </div>
                </div>
                <h4>Timeline</h4>
                <div class="timeline" id="tr-timeline">
                    <!-- Dynamic timeline injected here -->
                </div>
            </div>
        </section>

        <!-- FOOTER -->
        <footer style="text-align: center; padding: 40px; margin-top: 40px; color: var(--text-light);">
            <p>&copy; 2026 Jagat Dahal. All Rights Reserved.</p>
            <p>Kathmandu, Nepal | jagatdahal754@gmail.com</p>
        </footer>

        <!-- AI CHATBOT -->
        <div id="chat-widget">
            <div id="chat-window" class="clay">
                <div style="background: var(--accent-1); color: white; padding: 15px; border-radius: 16px 16px 0 0; font-weight: bold; display: flex; justify-content: space-between;">
                    <span>Support Assistant</span>
                    <i data-lucide="x" size="20" style="cursor:pointer;" onclick="toggleChat()"></i>
                </div>
                <div id="chat-messages">
                    <div class="msg bot">Hello! I'm the AI assistant for Jagat Dahal. How can I help you with your custom website project today?</div>
                </div>
                <div class="chat-input-area">
                    <input type="text" id="chat-input" class="clay-input" placeholder="Type a message..." style="padding: 10px; border-radius: 12px;" onkeypress="if(event.key === 'Enter') sendChat()">
                    <button class="clay-btn" style="padding: 10px; border-radius: 12px;" onclick="sendChat()"><i data-lucide="send" size="20"></i></button>
                </div>
            </div>
            <button id="chat-btn" class="clay-btn" onclick="toggleChat()">
                <i data-lucide="message-circle" size="28"></i>
            </button>
        </div>

        <script>
            lucide.createIcons();
            
            // Navigation
            function showSection(id) {
                document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
                document.getElementById(id).classList.remove('hidden');
                window.scrollTo(0,0);
            }

            function prefillOrder(type) {
                showSection('order');
                document.getElementById('o_type').value = type;
            }

            // Notifications
            function showToast(msg) {
                const toast = document.getElementById('toast');
                toast.innerText = msg;
                toast.style.transform = 'translateX(0)';
                setTimeout(() => toast.style.transform = 'translateX(150%)', 3000);
            }

            // Order Submission
            async function submitOrder(e) {
                e.preventDefault();
                const btn = document.getElementById('orderSubmitBtn');
                btn.innerText = "Submitting..."; btn.disabled = true;
                
                const features = Array.from(document.querySelectorAll('.f-check:checked')).map(cb => cb.value);
                const payload = {
                    customerName: document.getElementById('o_name').value,
                    email: document.getElementById('o_email').value,
                    whatsapp: document.getElementById('o_wa').value,
                    websiteType: document.getElementById('o_type').value,
                    title: document.getElementById('o_title').value,
                    budget: document.getElementById('o_budget').value,
                    description: document.getElementById('o_desc').value,
                    features
                };

                try {
                    const res = await fetch('/api/order', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json();
                    if(data.success) {
                        document.getElementById('order-box').classList.add('hidden');
                        document.getElementById('success-box').classList.remove('hidden');
                        document.getElementById('display-token').innerText = data.token;
                    } else { showToast(data.error); }
                } catch(err) {
                    showToast('Submission failed. Please try again.');
                }
                btn.innerText = "Submit Project Request"; btn.disabled = false;
            }

            function copyToken() {
                const token = document.getElementById('display-token').innerText;
                navigator.clipboard.writeText(token);
                showToast("Token copied!");
            }

            // Order Tracking
            async function trackOrder() {
                const token = document.getElementById('track-token').value.trim();
                if(!token) return showToast("Enter a valid token");

                try {
                    const res = await fetch('/api/order/' + token);
                    const data = await res.json();
                    if(data.success) {
                        document.getElementById('track-result').classList.remove('hidden');
                        const o = data.order;
                        document.getElementById('tr-title').innerText = o.title || "Custom Project";
                        document.getElementById('tr-type').innerText = o.websiteType;
                        document.getElementById('tr-status').innerText = o.status;
                        document.getElementById('tr-date').innerText = new Date(o.createdAt).toLocaleDateString();
                        
                        const timeline = document.getElementById('tr-timeline');
                        timeline.innerHTML = o.history.reverse().map(h => 
                            '<div class="timeline-item"><strong>' + h.status + '</strong><br>' + 
                            '<small style="color:#718096;">' + new Date(h.date).toLocaleDateString() + '</small><br>' + 
                            h.message + '</div>'
                        ).join('');
                    } else { showToast(data.error); }
                } catch(err) {
                    showToast('Lookup failed.');
                }
            }

            // Chat Logic
            let chatSessionId = localStorage.getItem('chatSessionId');
            if(!chatSessionId) {
                chatSessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
                localStorage.setItem('chatSessionId', chatSessionId);
            }

            function toggleChat() {
                const win = document.getElementById('chat-window');
                win.style.display = win.style.display === 'flex' ? 'none' : 'flex';
            }

            async function sendChat() {
                const input = document.getElementById('chat-input');
                const text = input.value.trim();
                if(!text) return;
                
                const msgs = document.getElementById('chat-messages');
                msgs.innerHTML += '<div class="msg user">' + text + '</div>';
                input.value = '';
                msgs.scrollTop = msgs.scrollHeight;

                try {
                    const res = await fetch('/api/chat', {
                        method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ sessionId: chatSessionId, message: text })
                    });
                    const data = await res.json();
                    msgs.innerHTML += '<div class="msg bot">' + data.reply + '</div>';
                    msgs.scrollTop = msgs.scrollHeight;
                } catch(err) {
                    msgs.innerHTML += '<div class="msg bot" style="color:red;">Failed to connect.</div>';
                }
            }
        </script>
    </body>
    </html>
    `);
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;