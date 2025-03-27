import os
import logging
from supabase import create_client, Client
from dotenv import load_dotenv
from urllib.parse import urlparse
from google.cloud import storage
from pathlib import Path, PurePath
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

"""
Logger
"""
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


# Load environment variables from .env file
load_dotenv()

# Supabase credentials
supabase_url: str = os.environ.get("SUPABASE_URL")
supabase_key: str = os.environ.get("SUPABASE_KEY")
# GCP informations
gcp_sa: str = os.environ.get("GCP_SERVICE_ACCOUNT_PATH")
gcp_public_base_url: str = os.environ.get("GCP_PUBLIC_BASE_URL")
# GCP bucket informations
gcp_bucket_name: str = os.environ.get("GCP_BUCKET_NAME")
gcp_folder_name: str = os.environ.get("GCP_FOLDER_NAME")

# Number of days to consider for old episodes
days_ago: int = int(os.environ.get("NB_EPISODES_TO_KEEP", 15))


def get_today_date() -> str:
    """Returns today's date in YYYY-MM-DD format."""
    return datetime.today().strftime('%Y-%m-%d')


def get_date_days_ago(days_ago: int) -> str:
    """Returns the date days_ago ago in YYYY-MM-DD format."""
    today: datetime = datetime.today()
    date_days_ago: datetime = today - timedelta(days=days_ago)
    return date_days_ago.strftime('%Y-%m-%d')


def get_old_episodes(supabase: Client) -> List[Dict[str, Any]]:
    """Retrieves episodes older than days_ago ago from the database."""
    date_days_ago: str = get_date_days_ago(days_ago)
    response = supabase.table("episodes").select("id, mp3_link").lt("publication_date", date_days_ago).execute()
    return response.data


def delete_watched_episodes(supabase: Client, episode_uuids: List[str]) -> None:
    """Deletes entries from watched_episodes table for the given episode UUIDs."""
    for uuid in episode_uuids:
        supabase.table("watched_episodes").delete().eq("episode_id", uuid).execute()
        logger.info(f"Deleted watched_episodes records for episode {uuid}")


def extract_filename_from_url(url: str) -> str:
    """Extracts filename from the mp3 URL."""
    parsed_url = urlparse(url)
    return PurePath.name(parsed_url.path)


def delete_mp3_files(mp3_links: List[Optional[str]]) -> None:
    """Deletes MP3 files from Cloud Storage bucket."""
    try:
        # Initialize GCS client
        storage_client: storage.Client = storage.Client.from_service_account_json(gcp_sa)
        
        bucket: storage.Bucket = storage_client.bucket(gcp_bucket_name)
        
        for mp3_link in mp3_links:
            if mp3_link:
                filename: str = extract_filename_from_url(mp3_link)
                # Create the correct path with "mp3" folder
                blob_path: str = f"{gcp_folder_name}/{filename}"
                blob: storage.Blob = bucket.blob(blob_path)
                blob.delete()
                logger.info(f"Deleted MP3 file from bucket: {blob_path}")
                
                # Optionally, delete the file from the local filesystem
                local_file_path: str = os.path.join("downloads", filename)
                if Path.exists(local_file_path):
                    Path.unlink(local_file_path)
                    logger.info(f"Deleted local MP3 file: {local_file_path}")
    
    except Exception as e:
        logger.error(f"Error deleting MP3 files: {e}")


def clean_old_episodes() -> None:
    """Main function to clean up old episodes."""
    # Initialize Supabase client
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # Get episodes older than days_ago
    old_episodes: List[Dict[str, Any]] = get_old_episodes(supabase)
    
    if not old_episodes:
        logger.info("No old episodes found to clean up.")
        return
    
    # Extract UUIDs and MP3 links
    episode_uuids: List[str] = [episode["uuid"] for episode in old_episodes]
    mp3_links: List[Optional[str]] = [episode["mp3_link"] for episode in old_episodes]
    
    # Delete watched episodes records
    delete_watched_episodes(supabase, episode_uuids)
    
    # Delete MP3 files from storage
    delete_mp3_files(mp3_links)
    
    logger.info(f"Successfully cleaned up {len(old_episodes)} old episodes.")


if __name__ == "__main__":
    clean_old_episodes()