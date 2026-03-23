FROM nginx:alpine
COPY scraper/map.html /usr/share/nginx/html/index.html
COPY data/graph-full.json /usr/share/nginx/html/data/graph-full.json
COPY nginx.conf /etc/nginx/conf.d/default.conf
