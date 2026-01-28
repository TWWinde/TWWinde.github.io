---
permalink: /
title: "Wenwu Tang"
excerpt: "Welcome to my homepage! 👋"
author_profile: true
header:
  overlay_images: 
    - hero-bg.png
    - hero-graz.png
  overlay_filter: 0.2
redirect_from: 
  - /about/
  - /about.html
---

I am a Ph.D. student at [TU Graz](https://www.tugraz.at/home), supervised by [Prof. Olga Saukh](https://sites.google.com/view/olgasaukh/home) at the [Embedded Learning and Sensing Systems (ELSS) Group](https://www.tugraz.at/en/arbeitsgruppen/iti-teams/elss/team-contact), Institute for Technical Informatics, TU Graz, Austria. Previously I finished my Master majoring in Electromobility at [University of Stuttgart](https://www.uni-stuttgart.de/en/) in Stuttgart, Germany, supervised by [Prof. Bin Yang](https://www.iss.uni-stuttgart.de/institut/team/Yang-00004/) at the [Institute of Signal Processing and System Theory](https://www.iss.uni-stuttgart.de/). Before that, I got my Bachelor degree at [China University of Petroleum](https://english.upc.edu.cn/) in Qingdao, China.


<div id="news" style="margin-top: 60px;"></div>
<hr style="border: 0; height: 1px; background-image: linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0)); margin: 20px 0;">

News
======
<style>
.news-list {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
  font-size: 0.9em;
  list-style-type: disc;
  padding-left: 20px;
  color: var(--global-text-color);
}
.news-list li {
  margin-bottom: 8px;
  line-height: 1.5;
}
.news-date {
  font-weight: bold;
  color: var(--global-text-color);
}
.news-highlight {
  color: #2ea44f; /* Green color similar to GitHub/Screenshot */
  font-weight: normal;
}
.news-badge {
    display: inline-flex;
    align-items: center;
    background-color: #24292e;
    color: #ffffff !important;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    margin-left: 6px;
    text-decoration: none !important;
    line-height: 1.2;
    vertical-align: middle;
}
.news-badge i {
  margin-right: 4px;
}
.news-badge:hover {
    background-color: #444;
    text-decoration: none;
}
</style>

<ul class="news-list">
  <li><span class="news-date">[Jan. 2026]</span> Our Paper <span class="news-highlight">GRAIL: Post-hoc Compensation by Linear Reconstruction for Compressed Networks</span> was accepted at <span class="news-highlight">CPAL'26</span>.</li>
  <li><span class="news-date">[Sep. 2025]</span> I started my PhD at TU Graz, Austria.</li>
  <!-- Example of how to add a paper with links (uncomment to use)
  <li><span class="news-date">[Dec. 2025]</span> Our paper on <span class="news-highlight">Efficient ML</span> was accepted at <span class="news-highlight">ICLR'26</span>. 
      <a href="#" class="news-badge"><i class="fas fa-file-pdf"></i> PDF</a>
      <a href="#" class="news-badge"><i class="fab fa-github"></i> Code</a>
  </li>
  -->
</ul>


<div id="publications" style="margin-top: 60px;"></div>
<hr style="border: 0; height: 1px; background-image: linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0)); margin: 20px 0;">

Publications
======
{% for post in site.publications reversed %}
  {% include archive-single.html %}
{% endfor %}


<div id="blog" style="margin-top: 60px;"></div>
<hr style="border: 0; height: 1px; background-image: linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0)); margin: 20px 0;">

Blog
======
*   [Blog Post number 4](/posts/2015/08/blog-post-4/)
*   [Blog Post number 3](/posts/2014/08/blog-post-3/)
*   [Blog Post number 2](/posts/2013/08/blog-post-2/)
*   [Blog Post number 1](/posts/2012/08/blog-post-1/)


