#!/bin/bash

echo "🚀 Fixing node-processor.vispera-dz.com setup..."

# 1. Stop any existing processes
echo "📍 Stopping existing Node.js processes..."
pm2 stop excel-processor 2>/dev/null || true
pm2 delete excel-processor 2>/dev/null || true

# 2. Create nginx configuration
echo "📍 Creating nginx configuration..."
sudo tee /etc/nginx/sites-available/node-processor > /dev/null << 'EOF'
server {
    listen 80;
    server_name node-processor.vispera-dz.com;
    
    # CORS headers
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
    
    # Handle preflight requests
    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 1728000;
        add_header 'Content-Type' 'text/plain charset=UTF-8';
        add_header 'Content-Length' 0;
        return 204;
    }
    
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
EOF

# 3. Enable the site
echo "📍 Enabling nginx site..."
sudo ln -sf /etc/nginx/sites-available/node-processor /etc/nginx/sites-enabled/

# 4. Test and reload nginx
echo "📍 Testing nginx configuration..."
if sudo nginx -t; then
    echo "✅ Nginx config is valid"
    sudo systemctl reload nginx
    echo "✅ Nginx reloaded"
else
    echo "❌ Nginx config has errors"
    exit 1
fi

# 5. Start Node.js server
echo "📍 Starting Node.js server..."
cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📍 Installing dependencies..."
    npm install
fi

# Start with PM2
pm2 start server.js --name "excel-processor"
pm2 save

# 6. Test endpoints
echo "📍 Testing endpoints..."
sleep 2

if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ Node.js server is responding on localhost:3001"
else
    echo "❌ Node.js server is not responding"
    pm2 logs excel-processor --lines 10
    exit 1
fi

if curl -f http://node-processor.vispera-dz.com/health > /dev/null 2>&1; then
    echo "✅ Domain is responding through nginx"
else
    echo "⚠️  Domain is not responding - check DNS settings"
    echo "   Make sure node-processor.vispera-dz.com points to this server's IP"
fi

echo ""
echo "🎉 Setup complete!"
echo "📍 Test URLs:"
echo "   http://localhost:3001/health"
echo "   http://node-processor.vispera-dz.com/health"
echo ""
echo "📝 If domain still doesn't work, check:"
echo "1. DNS: node-processor.vispera-dz.com -> your server IP"
echo "2. Firewall: ports 80 and 3001 are open"
echo "3. Run: pm2 logs excel-processor"