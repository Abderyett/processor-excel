#!/bin/bash

# Setup script for node-processor.vispera-dz.com
echo "🚀 Setting up node-processor.vispera-dz.com..."

# 1. Stop any existing Node.js processes
echo "📍 Stopping existing processes..."
pm2 stop excel-processor 2>/dev/null || true
pm2 delete excel-processor 2>/dev/null || true

# 2. Create nginx configuration
echo "📍 Setting up nginx configuration..."
sudo tee /etc/nginx/sites-available/node-processor > /dev/null << 'EOF'
server {
    listen 80;
    server_name node-processor.vispera-dz.com;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # CORS headers for all responses
    add_header 'Access-Control-Allow-Origin' '$http_origin' always;
    add_header 'Access-Control-Allow-Credentials' 'true' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Accept,Authorization,Cache-Control,Content-Type,DNT,If-Modified-Since,Keep-Alive,Origin,User-Agent,X-Requested-With' always;
    
    # Handle preflight OPTIONS requests
    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Allow-Origin' '$http_origin' always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Accept,Authorization,Cache-Control,Content-Type,DNT,If-Modified-Since,Keep-Alive,Origin,User-Agent,X-Requested-With' always;
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
        
        # Timeout settings
        proxy_connect_timeout       300s;
        proxy_send_timeout          300s;
        proxy_read_timeout          300s;
        send_timeout                300s;
        
        # Buffer settings
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
EOF

# 3. Enable the site
echo "📍 Enabling nginx site..."
sudo ln -sf /etc/nginx/sites-available/node-processor /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 4. Test nginx configuration
echo "📍 Testing nginx configuration..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Nginx configuration is valid"
    sudo systemctl reload nginx
    echo "✅ Nginx reloaded"
else
    echo "❌ Nginx configuration has errors"
    exit 1
fi

# 5. Start Node.js application
echo "📍 Starting Node.js application..."
cd "$(dirname "$0")/backend" || { echo "❌ Backend directory not found"; exit 1; }

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📍 Installing Node.js dependencies..."
    npm install
fi

# Start with PM2
pm2 start server.js --name "excel-processor"
pm2 save

echo "📍 Testing endpoints..."

# Test local endpoint
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ Local Node.js server is responding"
else
    echo "❌ Local Node.js server is not responding"
    pm2 logs excel-processor --lines 20
    exit 1
fi

# Test through nginx (wait a moment for nginx to reload)
sleep 2
if curl -f http://node-processor.vispera-dz.com/health > /dev/null 2>&1; then
    echo "✅ Domain is responding through nginx"
else
    echo "❌ Domain is not responding - check DNS settings"
    echo "🔍 Make sure node-processor.vispera-dz.com points to this server's IP"
fi

echo ""
echo "🎉 Setup complete!"
echo "📍 Backend running on: http://localhost:3001"
echo "📍 Domain URL: http://node-processor.vispera-dz.com"
echo "📍 Health check: curl http://node-processor.vispera-dz.com/health"
echo ""
echo "📝 Next steps:"
echo "1. Make sure DNS points node-processor.vispera-dz.com to this server"
echo "2. Consider setting up SSL with certbot for HTTPS"
echo "3. Test your frontend with the new backend"