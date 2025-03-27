import requests
import requests_random_user_agent
import re
import xmltodict
from bs4 import BeautifulSoup
import os
from supabase import create_client, Client
from dotenv import load_dotenv
from urllib.parse import urlparse
from google.cloud import storage
from pathlib import Path

load_dotenv()

# Supabase credentials
supabase_url: str = os.environ.get("SUPABASE_URL")
supabase_key: str  = os.environ.get("SUPABASE_KEY")
# GCP informations
gcp_sa: str = os.environ.get("GCP_SERVICE_ACCOUNT_PATH")
gcp_public_base_url = os.environ.get("GCP_PUBLIC_BASE_URL")


class MySupabase:
    def __init__(self):
        # Init Supabase client
        self.supabase: Client = create_client(supabase_url, supabase_key)


    def record_in_supabase_pg(self, episode: dict, table_name: str):
        try:
            if "mp3_link" not in episode:
                    print(f"Warning: The 'mp3_link' key is missing in the episode: {episode}. This item will be ignored.")
                    
            mp3_lien_a_verifier = episode["mp3_link"]
    
            # Check if an entry with the same mp3_link already exists
            response_verification = self.supabase.table(table_name).select("mp3_link").eq("mp3_link", mp3_lien_a_verifier).execute()
    
            if len(response_verification.data) > 0:
                print(f"MP3 link '{mp3_lien_a_verifier}' already present in the database. Moving to the next item.")
            else:
                # No existing entry, proceed with the record
                response_insertion = self.supabase.table(table_name).insert(episode).execute()
                print(response_insertion)
        except Exception as e:
            raise Exception(e)

  
    def upload_gcs(self, local_filename: str, bucket: str, folder_dest: str, filename:str) -> bool:
        """Upload a file to a Google Cloud Storage bucket.
    
        Args:
            local_filename (str): The complete path to the local file to upload.
            bucket (str): The name of the Google Cloud Storage bucket.
            filename (str): The name under which to save the file in the GCS bucket.
        """    
        # Initialize the Storage client with credentials
        client = storage.Client.from_service_account_json(gcp_sa)
    
        # Get the bucket
        bucket = client.bucket(bucket)
    
        # Create a Blob object (represents the file in the bucket)
        dest: str = f"{folder_dest}/{filename}"
        blob = bucket.blob(dest)
    
        try:
            # Upload the file from the local path
            blob.upload_from_filename(local_filename)
    
            print(f"The file '{local_filename}' has been successfully uploaded to 'gs://{bucket}/{filename}'")
            return True
    
        except Exception as e:
            print(f"An error occurred during the upload to GCS: {e}")
            raise Exception(e)
            return False

  
    def get_public_url(self, nom_bucket_gcs, nom_fichier_gcs) -> str:
        """Makes a Google Cloud Storage object publicly accessible and returns its public link.
    
        Args:
            nom_bucket_gcs (str): The name of the Google Cloud Storage bucket.
            nom_fichier_gcs (str): The name of the file in the GCS bucket.
    
        Returns:
            str: The public link of the object, or None in case of error.
        """
        try:
            # Initialiser le client Storage avec les informations d'identification
            client = storage.Client.from_service_account_json(gcp_sa)

            storage_client = client
            bucket = storage_client.bucket(nom_bucket_gcs)
            blob = bucket.blob(nom_fichier_gcs)
    
            # Rendre l'objet publiquement accessible
            try:
              blob.make_public()
            except:
              pass
    
            # Construire le lien public
            public_url = blob.public_url
    
            print(f"The object 'gs://{nom_bucket_gcs}/{nom_fichier_gcs}' is now public. Link: {public_url}")
            return public_url
    
        except Exception as e:
            raise Exception(e)


def extract_rss_link(url_podcast_addict):
    """
    Récupère le lien du flux RSS à partir d'une page Podcast Addict

    Args:
        url_podcast_addict: URL de la page Podcast Addict

    Returns:
        str: URL du flux RSS ou None si non trouvé
    """
    try:
        response = requests.get(url_podcast_addict)

        if response.status_code != 200:
            print(f"Error accessing the page: {response.status_code}")
            return None

        soup = BeautifulSoup(response.text, 'html.parser')

        liens = soup.find_all('a', href=re.compile(r'https://feeds\.audiomeans\.fr/feed'))

        if liens:
            # Return firt found link
            return liens[0]['href']

        # Alternative
        meta_rss = soup.find('meta', {'name': 'rss'})
        if meta_rss and 'content' in meta_rss.attrs:
            return meta_rss['content']

        print("RSS link not found on the page.")
        return None

    except Exception as e:
        print(f"Error extracting the RSS link: {e}")
        return None


def get_xml_content(url: str) -> str:
    response = requests.get(url)

    if response.status_code != 200:
        print("Error getting XML RSS page")
        return None

    return response.text


def convert_xml_to_dict(xml_src: str) -> dict:
    try:
        return xmltodict.parse(xml_src)
    except Exception as e:
        print(f"Error: {e}")


def extract_mp3_filename_from_url(url: str) -> str:
        # Extract mp3 file name from url
        parsed_url = urlparse(url)
        path = parsed_url.path
        filename = os.path.basename(path)

        return filename


def download_mp3_file(url_mp3):
    """Télécharge un fichier MP3 depuis une URL et l'enregistre localement
    avec le même nom que celui présent dans l'URL.

    Args:
        url_mp3 (str): L'URL du fichier MP3 à télécharger.
    """
    try:
        response = requests.get(url_mp3, stream=True)
        response.raise_for_status()

        filename: str = extract_mp3_filename_from_url(url_mp3)

        if not filename.endswith(".mp3"):
            print("Warning: The URL does not seem to point directly to an .mp3 file.")
            return

        with open(filename, 'wb') as local_file:
            for chunk in response.iter_content(chunk_size=8192):
                local_file.write(chunk)

        print(f"The MP3 file has been successfully downloaded with the name: {filename}")

        return filename

    except requests.exceptions.RequestException as e:
        print(f"Error downloading the file: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")


def generate_episodes_data(data_src: dict, nb_to_get: int) -> list:
    """
    [
      {
        "title": "",
        "original_mp3_link": "",
        "duration": "",
        "desription": "",
        "mp3_link": ""
      },
    ]
    """
    try:
        episodes: list = []
        base = data_src["rss"]["channel"]["item"]

        i = 0
        for ep in base:
            if i == nb_to_get:
              break

            episode: dict = {}

            episode["title"] = ep["title"]

            origin_mp3_link = ep["enclosure"]["@url"].split('?', 1)[0]

            if not origin_mp3_link.endswith(".mp3"):
                raise Exception("MP3 link not found")

            mp3_filename = extract_mp3_filename_from_url(origin_mp3_link)
            if not mp3_filename:
                raise Exception("MP3 filename not found")
            if Path(mp3_filename).exists():
                print(f"The file {mp3_filename} already exists. No download needed.")
                i += 1
                continue
            
            episode["original_mp3_link"] = origin_mp3_link
            episode["duration"] = ep["itunes:duration"]

            description = ep["description"].split('\n', 1)[0]
            if not description:
                raise Exception("Decsription not found")

            episode["description"] = description

            filename: str = download_mp3_file(episode["original_mp3_link"])

            if not filename:
                raise Exception("MP3 file not downloaded")
              
            supa = MySupabase()
            supa.upload_gcs(filename, "bigheads", "mp3", filename)
            pub_link = supa.get_public_url("bigheads", f"mp3/{filename}")
            episode["mp3_link"] = pub_link

            # Record episode in Supabase postgres
            supa.record_in_supabase_pg(episode, "episodes")
            episodes.append(episode)
            i += 1

        return episodes
    except Exception as e:
        print(f"Error : {e}")


def main():
  try:
    # "https://podcastaddict.com/podcast/les-grosses-tetes-integrales/5080893"
    rss_link: str = extract_rss_link(os.environ.get("AUDIO_SOURCE_URL"))
    
    xml_content = get_xml_content(rss_link)
    
    xml_dict: dict = convert_xml_to_dict(xml_content)
    
    episodes: list = generate_episodes_data(xml_dict, 15)

  except Exception as e:
      print(f"Error : {e}")


if __name__ == "__main__":
    main()