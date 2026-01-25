---
permalink: /
title: "About Me"
author_profile: true
redirect_from: 
  - /about/
  - /about.html
---

I am a Ph.D. student at TU Graz researching Efficient ML. My research focuses on... (Add more details about yourself here).


<div id="blogs"></div>
News
======
{% include base_path %}
{% for post in site.posts limit:5 %}
  {% include archive-single.html type="grid" %}
{% endfor %}


<div id="publications"></div>
Publications
======
{% for post in site.publications reversed %}
  {% include archive-single.html %}
{% endfor %}


<div id="cv"></div>
CV
======

## Education
* Ph.D. student in Efficient ML, TU Graz, Present
* M.S. in Jekyll, GitHub University, 2014
* B.S. in GitHub, GitHub University, 2012

## Work experience
* Spring 2024: Academic Pages Collaborator
  * GitHub University
  * Duties includes: Updates and improvements to template
  * Supervisor: The Users

* Fall 2015: Research Assistant
  * GitHub University
  * Duties included: Merging pull requests
  * Supervisor: Professor Hub

* Summer 2015: Research Assistant
  * GitHub University
  * Duties included: Tagging issues
  * Supervisor: Professor Git
  
## Skills
* Skill 1
* Skill 2
  * Sub-skill 2.1
  * Sub-skill 2.2
  * Sub-skill 2.3
* Skill 3

## Service and leadership
* Currently signed in to 43 different slack teams
