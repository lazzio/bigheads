import requests
import requests_random_user_agent
import re
import xmltodict
from bs4 import BeautifulSoup
import os
import logging
from supabase import create_client, Client
from dotenv import load_dotenv
from urllib.parse import urlparse
from google.cloud import storage
from datetime import datetime
from typing import List, Dict, Optional, Any
from mutagen.mp3 import MP3
from get_podlink_rss_url import get_rss_from_podlink

"""
Logger Configuration
"""
# Get the script name for the log file
script_name = os.path.basename(__file__)
log_file = os.path.splitext(script_name)[0] + '.log'

# Create logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Remove any existing handlers
if logger.hasHandlers():
    logger.handlers.clear()

# Create handlers
file_handler = logging.FileHandler(log_file)
console_handler = logging.StreamHandler()

# Set log level for handlers
file_handler.setLevel(logging.INFO)
console_handler.setLevel(logging.INFO)

# Create formatter and add to handlers
formatter = logging.Formatter("%(asctime)s - %(levelname)s: %(message)s")
file_handler.setFormatter(formatter)
console_handler.setFormatter(formatter)

# Add handlers to logger
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# Load environment variables
load_dotenv()

# Environment variables
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")
GCP_SA_PATH: str = os.environ.get("GCP_SERVICE_ACCOUNT_PATH", "")
GCP_PUBLIC_BASE_URL: str = os.environ.get("GCP_PUBLIC_BASE_URL", "")
AUDIO_SOURCE_URL: str = os.environ.get("AUDIO_SOURCE_URL", "")
DOWNLOAD_DIR: str = "./downloads"
NB_EPISODES_TO_KEEP: int = int(os.environ.get("NB_EPISODES_TO_KEEP", 15))

# Ensure download directory exists
os.makedirs(DOWNLOAD_DIR, exist_ok=True)


def get_mp3_duration(file_path: str) -> Optional[float]:
    """Get the duration of an MP3 file."""
    try:
        # Load the MP3 file
        if not os.path.exists(file_path):
            logger.error(f"File not found: {file_path}")
            return None
        if not file_path.endswith('.mp3'):
            logger.error(f"File is not an MP3: {file_path}")
            return None
        
        audio = MP3(file_path)
        
        # Get the duration in seconds
        if not audio.info or not hasattr(audio.info, 'length'):
            logger.error(f"Could not retrieve duration for file: {file_path}")
            return None
        duration_in_seconds = audio.info.length
        
        return duration_in_seconds
    except Exception as e:
        logger.error(f"Error getting duration for file {file_path}: {e}")
        return None


def validate_duration_format(duration: str) -> bool:
    """Validate the duration format HH:MM:SS."""
    pattern = r'^([0-9]{2}):([0-9]{2}):([0-9]{2})$'
    match = re.match(pattern, duration)
    
    if not match:
        return False
    
    # Extract hours, minutes, seconds
    hours, minutes, seconds = map(int, match.groups())
    
    # Validate ranges for hours, minutes, seconds
    if hours < 0 or hours > 23:
        return False
    if minutes < 0 or minutes > 59:
        return False
    if seconds < 0 or seconds > 59:
        return False
    
    return True

def convert_in_seconds(duration: str) -> float:
    """Convert HH:MM:SS duration to total seconds."""
    total_seconds: float = 0

    if not validate_duration_format(duration):
        raise ValueError(f"Invalid duration format: {duration}. Expected HH:MM:SS")

    # Divide the string into hours, minutes, and seconds
    hours, minutes, seconds = map(int, duration.split(':'))
    
    # Calculate total seconds
    total_seconds = hours * 3600 + minutes * 60 + seconds
    
    return total_seconds


class StorageManager:
    """Manages cloud storage operations."""
    
    def __init__(self, service_account_path: str):
        """Initialize with GCP service account details.
        
        Args:
            service_account_path: Path to GCP service account JSON file
        """
        self.service_account_path = service_account_path
        self.client = storage.Client.from_service_account_json(service_account_path)
    
    def upload_file(self, local_path: str, bucket_name: str, destination_folder: str, filename: str) -> bool:
        """Upload a file to Google Cloud Storage.
        
        Args:
            local_path: Path to local file
            bucket_name: GCS bucket name
            destination_folder: Target folder in bucket
            filename: Target filename
            
        Returns:
            bool: Success status
        """
        try:
            bucket = self.client.bucket(bucket_name)
            destination = f"{destination_folder}/{filename}"
            blob = bucket.blob(destination)
            
            blob.upload_from_filename(local_path)
            logger.info(f"Uploaded '{local_path}' to 'gs://{bucket_name}/{destination}'")
            return True
        except Exception as e:
            logger.error(f"Failed to upload to GCS: {e}")
            return False
    
    def get_public_url(self, bucket_name: str, file_path: str) -> str:
        """Make a file publicly accessible and return its URL.
        
        Args:
            bucket_name: GCS bucket name
            file_path: Path to file in bucket
            
        Returns:
            str: Public URL for the file
        """
        try:
            bucket = self.client.bucket(bucket_name)
            blob = bucket.blob(file_path)
            
            try:
                blob.make_public()
            except Exception:
                logger.warning(f"File may already be public: {file_path}")
                
            public_url = blob.public_url
            logger.info(f"Public URL for 'gs://{bucket_name}/{file_path}': {public_url}")
            return public_url
        except Exception as e:
            logger.error(f"Failed to get public URL: {e}")
            raise


class DatabaseManager:
    """Manages database operations."""
    
    def __init__(self, url: str, key: str):
        """Initialize with Supabase credentials.
        
        Args:
            url: Supabase URL
            key: Supabase API key
        """
        self.client: Client = create_client(url, key)
    
    def episode_exists(self, publication_date: str) -> bool:
        """Check if an episode with given date exists.
        
        Args:
            publication_date: Episode publication date
            
        Returns:
            bool: True if episode exists
        """
        response = self.client.table("episodes").select("publication_date").eq("publication_date", publication_date).execute()
        return len(response.data) > 0
    
    def episode_exists_by_url(self, original_url: str) -> bool:
        """Check if an episode with given original URL exists.
        
        Args:
            original_url: Original MP3 URL
            
        Returns:
            bool: True if episode exists
        """
        response = self.client.table("episodes").select("mp3_link").eq("original_mp3_link", original_url).execute()
        return len(response.data) > 0
    
    def save_episode(self, episode: Dict[str, Any], table_name: str = "episodes") -> bool:
        """Save episode data to database.
        
        Args:
            episode: Episode data dictionary
            table_name: Target table name
            
        Returns:
            bool: Success status
        """
        try:
            if "mp3_link" not in episode:
                logger.warning(f"Missing 'mp3_link' in episode data: {episode}")
                return False
                
            if self.episode_exists(episode["publication_date"]):
                logger.info(f"Episode with date '{episode['publication_date']}' already exists")
                return False
                
            response = self.client.table(table_name).insert(episode).execute()
            logger.info(f"Saved episode: {episode['title']}")
            return True
        except Exception as e:
            logger.error(f"Failed to save episode: {e}")
            return False


class PodcastFetcher:
    """Handles podcast feed fetching and processing."""
    
    def extract_rss_link(self, podcast_url: str) -> Optional[str]:
        """Extract RSS feed URL from podcast page.
        
        Args:
            podcast_url: Podcast page URL
            
        Returns:
            str or None: RSS feed URL if found
        """
        try:            
            response = requests.get(podcast_url)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Try finding RSS link in anchor tags
            links = soup.find_all('a', href=re.compile(r'https://feeds\.audiomeans\.fr/feed'))
            if links:
                return links[0]['href']
            
            # Try meta tag
            meta_rss = soup.find('meta', {'name': 'rss'})
            if meta_rss and 'content' in meta_rss.attrs:
                return meta_rss['content']
                
            logger.warning("RSS link not found on page")
            return None
        except Exception as e:
            logger.error(f"Failed to extract RSS link: {e}")
            return None
    
    def get_feed_content(self, feed_url: str) -> Optional[str]:
        """Fetch RSS feed content.
        
        Args:
            feed_url: RSS feed URL
            
        Returns:
            str or None: XML content if successful
        """
        try:
            response = requests.get(feed_url)
            response.raise_for_status()
            return response.text
        except Exception as e:
            logger.error(f"Failed to fetch RSS feed: {e}")
            return None
    
    def parse_feed(self, xml_content: str) -> Optional[Dict]:
        """Parse XML feed to dictionary.
        
        Args:
            xml_content: XML feed content
            
        Returns:
            dict or None: Parsed feed data
        """
        try:
            return xmltodict.parse(xml_content)
        except Exception as e:
            logger.error(f"Failed to parse XML: {e}")
            return None
    
    def download_mp3(self, url: str) -> Optional[str]:
        """Download MP3 file from URL.
        
        Args:
            url: MP3 file URL
            
        Returns:
            str or None: Local filename if successful
        """
        try:
            # Clean URL by removing query parameters
            clean_url = url.split('?', 1)[0]
            
            # Extract filename
            filename = os.path.basename(urlparse(clean_url).path)
            if not filename.endswith(".mp3"):
                logger.warning(f"URL doesn't point to MP3 file: {url}")
                return None
                
            local_path = os.path.join(DOWNLOAD_DIR, filename)
            
            # Check if already downloaded
            if os.path.exists(local_path):
                logger.info(f"File already exists: {filename}")
                return filename
                            
            response = requests.get(clean_url, stream=True)
            response.raise_for_status()
            
            with open(local_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
                    
            logger.info(f"Downloaded MP3: {filename}")
            return filename
        except Exception as e:
            logger.error(f"Failed to download MP3: {e}")
            return None


def convert_pubdate_format(pub_date_str: str) -> str:
    """Convert publication date to ISO format.
    
    Args:
        pub_date_str: Date string in RSS format
        
    Returns:
        str: Date in YYYY-MM-DD format
    """
    try:
        # Try standard format with timezone
        date_obj = datetime.strptime(pub_date_str, '%a, %d %b %Y %H:%M:%S %Z')
        return date_obj.strftime('%Y-%m-%d')
    except ValueError:
        try:
            # Try without timezone
            date_obj = datetime.strptime(pub_date_str.split(' GMT')[0], '%a, %d %b %Y %H:%M:%S')
            return date_obj.strftime('%Y-%m-%d')
        except Exception as e:
            logger.warning(f"Could not parse date '{pub_date_str}': {e}")
            return pub_date_str


def process_episodes(feed_data: Dict, max_episodes: int, db_manager: DatabaseManager, 
                     storage_manager: StorageManager) -> List[Dict]:
    """Process episodes from feed data.
    
    Args:
        feed_data: Parsed feed dictionary
        max_episodes: Maximum number of episodes to process
        db_manager: Database manager instance
        storage_manager: Storage manager instance
        
    Returns:
        list: Processed episodes
    """
    processed_episodes = []
    fetcher = PodcastFetcher()
    
    try:
        items = feed_data["rss"]["channel"]["item"]
        count = 0
        
        for item in items:
            if not validate_duration_format(item["itunes:duration"]):
                continue
            
            if count >= max_episodes:
                break
            
            if "<p>" in item["description"]:
                description = item["description"].split("<p>", 1)[0]
            else:
                description = item["description"].split('\n', 1)[0] if '\n' in item["description"] else item["description"]
                
            # Extract basic episode data
            episode = {
                "title": item["title"],
                "publication_date": convert_pubdate_format(item["pubDate"]),
                "description": description,
            }
            
            # Get original MP3 URL
            original_mp3_url = item["enclosure"]["@url"].split('?', 1)[0]
            if not original_mp3_url.endswith(".mp3"):
                logger.warning(f"Not an MP3 URL: {original_mp3_url}")
                continue
                
            episode["original_mp3_link"] = original_mp3_url
            
            # Skip if already in database
            if db_manager.episode_exists(episode["publication_date"]) or db_manager.episode_exists_by_url(original_mp3_url):
                logger.info(f"Episode already exists: {episode['title']}")
                count += 1
                continue
                
            # Download MP3
            mp3_filename = fetcher.download_mp3(original_mp3_url)
            if not mp3_filename:
                logger.warning(f"Failed to download MP3 for: {episode['title']}")
                continue
            
            # Get duration
            local_path = os.path.join(DOWNLOAD_DIR, mp3_filename)
            duration: float = get_mp3_duration(local_path)
            if duration is None:
                logger.warning(f"Failed to get duration for: {mp3_filename}")
                duration = item["itunes:duration"],
            
            episode["duration"] = duration

            # Upload to cloud storage
            if storage_manager.upload_file(local_path, "bigheads", "mp3", mp3_filename):
                # Get public URL
                public_url = storage_manager.get_public_url("bigheads", f"mp3/{mp3_filename}")
                episode["mp3_link"] = public_url
                
                # Save to database
                if db_manager.save_episode(episode):
                    processed_episodes.append(episode)
                    
            count += 1
            
        return processed_episodes
    except Exception as e:
        logger.error(f"Failed to process episodes: {e}")
        return processed_episodes


def main():
    """Main function to run the podcast processing pipeline."""
    try:
        logger.info("Starting podcast processing")
        
        # Initialize managers
        db_manager = DatabaseManager(SUPABASE_URL, SUPABASE_KEY)
        storage_manager = StorageManager(GCP_SA_PATH)
        fetcher = PodcastFetcher()
        
        # Get RSS feed
        # rss_link = fetcher.extract_rss_link(AUDIO_SOURCE_URL)
        # if not rss_link:
        #     logger.error("Could not find RSS link")
        #     return
        rss_url = get_rss_from_podlink(AUDIO_SOURCE_URL)
        if not rss_url:
            logger.error("Could not find RSS URL")
            return

        # Get and parse feed
        xml_content = fetcher.get_feed_content(rss_url)
        if not xml_content:
            logger.error("Could not fetch feed content")
            return
            
        feed_data = fetcher.parse_feed(xml_content)
        if not feed_data:
            logger.error("Could not parse feed")
            return
            
        # Process episodes
        episodes = process_episodes(feed_data, NB_EPISODES_TO_KEEP, db_manager, storage_manager)
        logger.info(f"Processed {len(episodes)} episodes")
        
    except Exception as e:
        logger.error(f"Error in main process: {e}")


if __name__ == "__main__":
    main()