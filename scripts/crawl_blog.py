#!/usr/bin/env python3
"""
Blog Post Crawler using crawl4ai
Crawls blog posts (such as articles from flaviocopes.com) and outputs clean,
structured Markdown with YAML frontmatter suitable for documentation and blogs.
"""

import sys
import os
import re
import argparse
import asyncio
from typing import Dict, Any
from bs4 import BeautifulSoup
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, CacheMode

def extract_metadata(html: str, url: str) -> Dict[str, Any]:
    """Extract metadata (title, author, date, description, tags) from HTML."""
    soup = BeautifulSoup(html, "html.parser")
    
    # Title
    h1 = soup.find("h1")
    title = h1.get_text().strip() if h1 else "A deep dive into Herdr"
    
    # Description
    meta_desc = soup.find("meta", attrs={"name": "description"})
    og_desc = soup.find("meta", attrs={"property": "og:description"})
    description = ""
    if meta_desc and meta_desc.get("content"):
        description = meta_desc["content"].strip()
    elif og_desc and og_desc.get("content"):
        description = og_desc["content"].strip()
    
    # Fallback to the introductory lead paragraph if meta description wasn't found
    if not description:
        for p in soup.find_all("p"):
            p_text = p.get_text().strip()
            if len(p_text) > 40 and not p_text.startswith("By ") and not p_text.startswith("In this post"):
                description = p_text
                break

    # Author
    author = "Flavio Copes"
    author_el = soup.find(string=re.compile(r"By\s+"))
    if author_el:
        parent = author_el.parent
        author = parent.get_text().replace("By", "").strip() or author
    
    # Date
    date_str = "Aug 10, 2026"
    date_el = soup.find(string=re.compile(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}"))
    if date_el:
        date_str = date_el.strip()
    
    # Tags
    tags = ["AI", "Herdr", "Terminal", "Coding Agents", "Multiplexer"]
    tag_links = soup.find_all("a", href=re.compile(r"/tags/"))
    found_tags = [t.get_text().strip() for t in tag_links if t.get_text().strip()]
    if found_tags:
        tags = list(dict.fromkeys(found_tags + tags))
        
    return {
        "title": title,
        "author": author,
        "date": date_str,
        "description": description,
        "tags": tags,
        "source_url": url,
    }

def clean_markdown_body(raw_md: str, title: str) -> str:
    """Strip website chrome, banners, and footer navigation from markdown."""
    lines = raw_md.splitlines()
    
    # Find start of main content: Skip header links, banners, etc.
    start_idx = 0
    title_pattern = re.compile(rf"^#\s+{re.escape(title)}", re.IGNORECASE)
    for i, line in enumerate(lines):
        if title_pattern.search(line.strip()):
            start_idx = i
            break
        elif line.strip() == title:
            start_idx = i
            break
            
    content_lines = lines[start_idx:]
    
    # Find end of main content: Stop before newsletter promo / footer navigation
    end_idx = len(content_lines)
    for i, line in enumerate(content_lines):
        line_clean = line.strip()
        if (
            line_clean.startswith("Free ebooks")
            or line_clean.startswith("Explore\n")
            or line_clean == "Explore"
            or line_clean == "Programs"
            or line_clean.startswith("Related posts about")
            or line_clean == "Topics"
        ):
            end_idx = i
            break
            
    body = "\n".join(content_lines[:end_idx]).strip()
    
    # Remove leading '# Title' if present so we can manage heading levels cleanly
    body = re.sub(rf"^#\s+{re.escape(title)}\s*", "", body, flags=re.IGNORECASE).strip()
    
    # Remove author & date block if duplicated at start
    body = re.sub(r"^By\s+\[.*?\]\(.*?\)\s*\n+", "", body)
    body = re.sub(r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s*\n+", "", body)
    
    # Standardize tilde dividers
    body = re.sub(r"\n~~~\n", "\n---\n", body)
    body = re.sub(r"^~~~+\s*", "", body).strip()
    
    # Auto-tag untagged mermaid code blocks if detected
    body = re.sub(r"```\s*\n(flowchart\s+[A-Z]{2}|sequenceDiagram|stateDiagram|classDiagram|erDiagram)", r"```mermaid\n\1", body)
    
    return body

def build_frontmatter(metadata: Dict[str, Any]) -> str:
    """Build YAML frontmatter string."""
    tags_formatted = "\n".join([f"  - {tag}" for tag in metadata.get("tags", [])])
    return f"""---
title: "{metadata.get('title', '')}"
description: "{metadata.get('description', '')}"
author: "{metadata.get('author', 'Flavio Copes')}"
date: "{metadata.get('date', '')}"
source_url: "{metadata.get('source_url', '')}"
tags:
{tags_formatted}
---
"""

async def crawl_post(url: str, output_path: str) -> None:
    """Crawl a single blog post using crawl4ai and save as markdown."""
    print(f"[*] Crawling {url} using crawl4ai...")
    
    config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        css_selector="article",
    )
    
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url, config=config)
        
        if not result.success:
            print(f"[!] Crawl failed with status: {result.status_code}")
            sys.exit(1)
            
        metadata = extract_metadata(result.html, url)
        body = clean_markdown_body(result.markdown, metadata["title"])
        
        frontmatter = build_frontmatter(metadata)
        
        # Assemble final document
        full_content = f"{frontmatter}\n# {metadata['title']}\n\n> **Original Source**: [{url}]({url})\n> **Author**: {metadata['author']} | **Date**: {metadata['date']}\n\n{body}\n"
        
        # Ensure target directory exists
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(full_content)
            
        print(f"[+] Successfully saved {len(full_content)} characters to: {output_path}")

def main():
    parser = argparse.ArgumentParser(description="Crawl blog posts to markdown using crawl4ai")
    parser.add_argument(
        "--url",
        default="https://flaviocopes.com/herdr/",
        help="URL of the blog post to crawl (default: https://flaviocopes.com/herdr/)"
    )
    parser.add_argument(
        "--output",
        default=os.path.join("docs", "blog", "a-deep-dive-into-herdr.md"),
        help="Destination markdown file path"
    )
    args = parser.parse_args()
    
    asyncio.run(crawl_post(args.url, args.output))

if __name__ == "__main__":
    main()
