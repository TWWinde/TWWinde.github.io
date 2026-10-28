---
permalink: /
title: "Wenwu Tang"
excerpt: "Welcome to my homepage! 👋"
author_profile: true
header:
  overlay_images: 
    - hero-qingdao.png
    - hero-stuttgart.png
    - hero-graz.png
  overlay_filter: 0.2
redirect_from: 
  - /about/
  - /about.html
---

<div class="home-intro">
  <p>I am a Ph.D. student at <a href="https://www.tugraz.at/home">TU Graz</a>, supervised by <a href="https://sites.google.com/view/olgasaukh/home">Prof. Olga Saukh</a> at the <a href="https://www.tugraz.at/en/arbeitsgruppen/iti-teams/elss/team-contact">Embedded Learning and Sensing Systems (ELSS) Group</a>, Institute for Technical Informatics, TU Graz, Austria.</p>
  <p>Previously, I completed my Master's degree in Electromobility at the <a href="https://www.uni-stuttgart.de/en/">University of Stuttgart</a>, supervised by <a href="https://www.iss.uni-stuttgart.de/institut/team/Yang-00004/">Prof. Bin Yang</a> at the <a href="https://www.iss.uni-stuttgart.de/">Institute of Signal Processing and System Theory</a>. I received my Bachelor's degree from <a href="https://english.upc.edu.cn/">China University of Petroleum</a> in Qingdao, China.</p>
  <div class="home-focus" aria-label="Research interests">
    <span>Efficient Machine Learning</span>
    <span>Model Compression</span>
    <span>Embedded Intelligence</span>
  </div>
</div>

<section id="news" class="home-section">
  <div class="home-section__header">
    <h2>News</h2>
    <span class="home-section__eyebrow">Latest updates</span>
  </div>

<ul class="news-list">
  <li><span class="news-date">Jan. 2026</span><span>Our paper <span class="news-highlight">GRAIL: Post-hoc Compensation by Linear Reconstruction for Compressed Networks</span> was accepted at <a href="https://cpal.cc/">CPAL'26</a>.</span></li>
  <li><span class="news-date">Sep. 2025</span><span>I started my Ph.D. at TU Graz, Austria.</span></li>
</ul>
</section>

<section id="publications" class="home-section">
  <div class="home-section__header">
    <h2>Publications</h2>
    <span class="home-section__eyebrow">Selected research</span>
  </div>
{% for post in site.publications reversed %}
  {% include archive-single.html %}
{% endfor %}
</section>

<section id="blog" class="home-section">
  <div class="home-section__header">
    <h2>Blog</h2>
    <span class="home-section__eyebrow">Notes &amp; ideas</span>
  </div>
  <div class="blog-grid">
    <a class="blog-card" href="/posts/2025/08/blog-post-1/"><span class="blog-card__meta">Learning notes</span><span class="blog-card__title">Flow Matching and Diffusion Models</span></a>
    <a class="blog-card" href="/posts/2015/08/blog-post-4/"><span class="blog-card__meta">Blog</span><span class="blog-card__title">Blog Post number 4</span></a>
    <a class="blog-card" href="/posts/2014/08/blog-post-3/"><span class="blog-card__meta">Blog</span><span class="blog-card__title">Blog Post number 3</span></a>
    <a class="blog-card" href="/posts/2013/08/blog-post-2/"><span class="blog-card__meta">Blog</span><span class="blog-card__title">Blog Post number 2</span></a>
  </div>
</section>

<section id="visitor-map" class="home-section">
  <div class="home-section__header">
    <h2>Visitors</h2>
    <span class="home-section__eyebrow">Around the world</span>
  </div>
<div class="visitor-card">
  <script type="text/javascript" id="mapmyvisitors" src="https://mapmyvisitors.com/map.js?cl=ffffff&w=a&t=n&d=SX29sULPnpyIEVjJl-Qu1xsJlgUOdgoc0ZECpMMrr6c"></script>
</div>
</section>
