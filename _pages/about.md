---
permalink: /
title: "About Me"
author_profile: true
redirect_from: 
  - /about/
  - /about.html
---

I am a Ph.D. student at [TU Graz](https://www.tugraz.at/home), supervised by [Olga Saukh](https://sites.google.com/view/olgasaukh/home) at the [Embedded Learning and Sensing Systems (ELSS) Group](https://www.tugraz.at/en/arbeitsgruppen/iti-teams/elss/team-contact), Institute for Technical Informatics, TU Graz, Austria.


<div id="news" style="margin-top: 60px;"></div>
<hr style="border: 0; height: 1px; background-image: linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0)); margin: 20px 0;">

News
======
*   **Jan 2026**: Updated website layout.
*   **Present**: Ph.D. student at TU Graz.


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
{% include base_path %}
{% for post in site.posts limit:5 %}
  {% include archive-single.html %}
{% endfor %}


<div id="cv" style="margin-top: 60px;"></div>
<hr style="border: 0; height: 1px; background-image: linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0)); margin: 20px 0;">

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
